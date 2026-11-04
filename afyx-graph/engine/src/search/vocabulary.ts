/**
 * Word lists used to keep filler out of search input.
 *
 * Two independent vocabularies exist because they guard different consumers:
 * `STOP_WORDS` trims terms of a code-search query before they reach full-text
 * matching, while `PROSE_STOP_WORDS` decides which words of a free-form prompt
 * may be treated as evidence that a symbol was named at all.
 */

const words = (list: string): string[] => list.split(/\s+/).filter(Boolean);

const QUERY_FILLER = {
  connectors: words('the a an and or but in on at to for of with by from into over out up as if so then than also just only more some such all each every no not'),
  auxiliaries: words('is it its that this are was be been has had have do does did will would could should may might can shall'),
  questions: words('how what where when who which why'),
  pronouns: words('i me my we our you your he she they'),
  requests: words('show give tell look need needs want happen happens affect affected break breaks failing implemented implement done made used using work works found'),
  // Words about code in general; names such as get/set/add/build/find/list are deliberately absent.
  codeNoise: words('code file files function method class type fix bug called'),
};

export const STOP_WORDS: ReadonlySet<string> = new Set(Object.values(QUERY_FILLER).flat());

const PROSE_FILLER = {
  // Function words and hedges: never evidence that a symbol was named.
  hedges: words(`about above actually after again against almost along also always another anything around away back because been before behind being below best better
    between both cannot come could does doing done down each either else even ever every everything fine first from getting give goes going gone good great have having help here
    inside instead into just keep know last least less like likely little look looking made make making many maybe mind more most much must need needs never next nice none nothing
    okay only onto other otherwise over please pretty probably quite rather really right same seem seems should show since some someone something somewhere soon still such sure take
    than thank thanks that their them then there these they thing things think this those though tried tries trying under until upon very want wants well went were what when which
    while will wish with within without would wrong your yours`),
  // Words about code rather than of it: common in prompts, rarely the symbol's own name.
  aboutCode: words(`change changes check class classes code detail details directory error errors example examples file files folder function functions issue issues line lines
    method methods name names problem problems project question questions rename test tests type types update value values warning warnings work working write writing`),
};

export const PROSE_STOP_WORDS: ReadonlySet<string> = new Set(Object.values(PROSE_FILLER).flat());
