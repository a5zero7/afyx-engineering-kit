/** The persistence surface handed to the shared scenarios (see scenarios.mjs). */
import { DatabaseConnection, removeDatabaseFiles, resolveWalHealBytes } from '../../src/db';
import { QueryBuilder } from '../../src/db/queries';
import { createDatabase } from '../../src/db/sqlite-adapter';
import * as migrations from '../../src/db/migrations';

export const srcApi = { DatabaseConnection, QueryBuilder, createDatabase, migrations, removeDatabaseFiles, resolveWalHealBytes };
