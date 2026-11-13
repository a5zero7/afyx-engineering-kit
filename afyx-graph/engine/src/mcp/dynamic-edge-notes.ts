import type { Edge } from '../types';

export interface SynthesizedEdgeNote {
  label: string;
  compact: string;
  registeredAt?: string;
}

type EdgeMetadata = Record<string, unknown>;
type Formatter = (meta: EdgeMetadata, atSuffix: string) => Omit<SynthesizedEdgeNote, 'registeredAt'>;

const codeSpan = (value: unknown, fallback: string): string =>
  value !== undefined && value !== null && value !== '' ? `\`${String(value)}\`` : fallback;

const rawText = (value: unknown, fallback = ''): string =>
  value !== undefined && value !== null ? String(value) : fallback;

const EDGE_NOTE_TABLE: Record<string, Formatter> = {
  callback(meta, atSuffix) {
    const registrar = codeSpan(meta.via, 'a registrar');
    const fieldPart = meta.field ? ` on .${String(meta.field)}` : '';
    return {
      label: `callback — registered via ${registrar}${fieldPart} (dynamic dispatch)`,
      compact: `dynamic: callback via ${registrar}${atSuffix}`,
    };
  },
  'http-client'(meta, atSuffix) {
    const endpoint = `${rawText(meta.method, 'GET')} ${rawText(meta.href)}`.trim();
    return {
      label: `HTTP request \`${endpoint}\` — client request associated with the indexed server endpoint`,
      compact: `dynamic: HTTP ${endpoint}${atSuffix}`,
    };
  },
  'queue-job'(meta, atSuffix) {
    const jobName = codeSpan(meta.event, 'a job');
    const queueClause = meta.queue ? ` on queue \`${String(meta.queue)}\`` : '';
    return {
      label: `queue job ${jobName}${queueClause} — producer → consumer (cross-tier)`,
      compact: `dynamic: queue job ${jobName}${atSuffix}`,
    };
  },
  'event-bus'(meta, atSuffix) {
    const eventName = codeSpan(meta.event, 'an event');
    const channelKind = meta.channel === 'socket' ? 'socket message' : 'bus event';
    let direction = '';
    if (meta.tier === 'client→server') direction = ', client → server';
    else if (meta.tier === 'server→client') direction = ', server → client';
    return {
      label: `${channelKind} ${eventName} — emit → handler${direction} (dynamic dispatch)`,
      compact: `dynamic: ${channelKind} ${eventName}${atSuffix}`,
    };
  },
  'event-emitter'(meta, atSuffix) {
    const eventName = codeSpan(meta.event, 'an event');
    return {
      label: `event ${eventName} — emit → handler (dynamic dispatch)`,
      compact: `dynamic: event ${eventName}${atSuffix}`,
    };
  },
  'react-render'(_meta, atSuffix) {
    return {
      label: 'React re-render — state changes schedule a render pass (dynamic dispatch)',
      compact: `dynamic: React re-render via setState${atSuffix}`,
    };
  },
  'jsx-render'(meta) {
    const component = meta.via ? `<${String(meta.via)}>` : 'a child component';
    return {
      label: `renders ${component} (JSX child — dynamic dispatch)`,
      compact: `dynamic: renders ${component}`,
    };
  },
  'vue-handler'(meta) {
    const binding = meta.event ? `@${String(meta.event)}` : 'a template event';
    return {
      label: `Vue template handler — bound to ${binding} (dynamic dispatch)`,
      compact: `dynamic: Vue ${binding} handler`,
    };
  },
  'interface-impl'(_meta, atSuffix) {
    return {
      label: 'interface/abstract dispatch — the selected implementation supplies the invoked body (dynamic dispatch)',
      compact: `dynamic: interface → impl${atSuffix}`,
    };
  },
  'closure-collection'(meta, atSuffix) {
    const targetField = codeSpan(meta.field, 'a collection');
    return {
      label: `closure collection — runs handlers appended to ${targetField} (dynamic dispatch)`,
      compact: `dynamic: runs ${targetField} handlers${atSuffix}`,
    };
  },
  'fn-pointer-dispatch'(meta, atSuffix) {
    const viaLabel = codeSpan(meta.via, 'a function pointer');
    return {
      label: `function-pointer dispatch via ${viaLabel} (dynamic dispatch)`,
      compact: `dynamic: fn-pointer ${rawText(meta.via)}${atSuffix}`,
    };
  },
  'goframe-route'(meta, atSuffix) {
    const routeLabel = codeSpan(meta.route, 'a route');
    return {
      label: `GoFrame route ${routeLabel} — Bind registration selects this controller method (dynamic dispatch)`,
      compact: `dynamic: GoFrame route ${rawText(meta.route)}${atSuffix}`,
    };
  },
};

/**
 * Formats an explanatory annotation for heuristic/dynamic edges while returning
 * null for plain static call edges.
 */
export function describeSynthesizedEdge(edge: Edge | null): SynthesizedEdgeNote | null {
  if (!edge || edge.provenance !== 'heuristic') {
    return null;
  }
  const meta = edge.metadata as EdgeMetadata | undefined;
  const kindRaw = meta?.synthesizedBy;
  if (typeof kindRaw !== 'string' || kindRaw.length === 0) {
    return null;
  }

  const registeredAt = typeof meta?.registeredAt === 'string' ? meta.registeredAt : undefined;
  const atSuffix = registeredAt ? ` @${registeredAt}` : '';
  const formatter = EDGE_NOTE_TABLE[kindRaw];
  if (formatter) {
    return { ...formatter(meta ?? {}, atSuffix), registeredAt };
  }

  const normalizedKind = kindRaw.replace(/-/g, ' ');
  return {
    label: `${normalizedKind} (dynamic dispatch)`,
    compact: `dynamic: ${normalizedKind}${atSuffix}`,
    registeredAt,
  };
}
