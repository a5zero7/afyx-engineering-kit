/**
 * Afyx Graph canonical product identity.
 *
 * The single source of truth for every name that reaches users, files, or wire
 * protocols. Consumers import these constants; nothing else declares them.
 * Runtime configuration is read only from AFYX_GRAPH_* environment variables.
 */

export const PRODUCT_NAME = 'Afyx Graph';
export const CLI_NAME = 'afyx-graph';
export const MCP_SERVER_NAME = 'afyx_graph';
export const MCP_TOOL_PREFIX = 'afyx_graph_';
export const STATE_DIR_NAME = '.afyx-graph';
export const DATABASE_FILE_NAME = 'afyx-graph.db';
export const ENV_PREFIX = 'AFYX_GRAPH_';
