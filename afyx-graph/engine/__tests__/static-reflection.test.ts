import { expect, it } from 'vitest';
import { schemaFixture } from './schema-dispatch-fixture';

it('distinguishes callable references, metadata lookups and lexical invocations', async () => {
  const php = "<?php namespace App;\nclass Controller {\n public function action() {}\n public function route() {\n  return [Controller::class, 'action'];\n }\n public function inspect() {\n  return new ReflectionMethod(Controller::class, 'action');\n }\n}";
  await schemaFixture({
    'controller.php': php,
    'Reflect.cs': 'namespace App;\nclass Known { public void Work() {} }\nclass Reflections {\n public void Meta() { typeof(Known).GetMethod("Work"); }\n public void Create() { Activator.CreateInstance(typeof(Known)); }\n public void Unresolved(string name) { typeof(Known).GetMethod(name); }\n}\nclass Overloaded { public void Run() {} public void Run(string name) {} }\nclass Ambiguity { public void Meta() { typeof(Overloaded).GetMethod("Run"); } }',
    'reflect.rb': 'class Runner\n def run\n end\n def pick\n  public_send(:run)\n end\n def unknown(name)\n  public_send(name)\n end\nend',
  }, async ({ graph, symbol, write }) => {
    const edges = (file: string, name: string) => graph.getOutgoingEdges(symbol(file, name))
      .filter(edge => edge.metadata?.synthesis === 'static-reflection')
      .map(edge => [edge.kind, edge.target]);
    const action = symbol('controller.php', 'App::Controller::action');
    expect(edges('controller.php', 'App::Controller::route')).toEqual([['references', action]]);
    expect(edges('controller.php', 'App::Controller::inspect')).toEqual([['references', action]]);
    expect(edges('Reflect.cs', 'App::Reflections::Meta')).toEqual([['references', symbol('Reflect.cs', 'App::Known::Work')]]);
    expect(edges('Reflect.cs', 'App::Reflections::Create')).toEqual([['instantiates', symbol('Reflect.cs', 'App::Known')]]);
    expect(edges('Reflect.cs', 'App::Reflections::Unresolved')).toEqual([]);
    expect(edges('Reflect.cs', 'App::Ambiguity::Meta')).toEqual([]);
    expect(edges('reflect.rb', 'Runner::pick')).toEqual([['calls', symbol('reflect.rb', 'Runner::run')]]);
    expect(edges('reflect.rb', 'Runner::unknown')).toEqual([]);
    write('controller.php', php.replaceAll("'action'", '$method'));
    await graph.sync({ paths: ['controller.php'] });
    expect(edges('controller.php', 'App::Controller::route')).toEqual([]);
    expect(edges('controller.php', 'App::Controller::inspect')).toEqual([]);
  });
});
