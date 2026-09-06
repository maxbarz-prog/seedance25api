import { DataStore } from "./data/types";

// Backend selection: DB_BACKEND=dynamo (AWS, tables from sst.config.ts) or
// sqlite (default, local file). Routes import the async facade below and
// never see which backend is active.

export type {
  AdminData,
  AdminJobRow,
  AdminUserRow,
  Job,
  JobMode,
  JobStatus,
  LedgerEntry,
  Membership,
  User,
} from "./data/types";

let _store: DataStore | null = null;

export function store(): DataStore {
  if (_store) return _store;
  if (process.env.DB_BACKEND === "dynamo") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DynamoStore } = require("./data/dynamo") as typeof import("./data/dynamo");
    _store = new DynamoStore();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SqliteStore } = require("./data/sqlite") as typeof import("./data/sqlite");
    _store = new SqliteStore();
  }
  return _store;
}

export const createUser: DataStore["createUser"] = (...a) => store().createUser(...a);
export const userByEmail: DataStore["userByEmail"] = (...a) => store().userByEmail(...a);
export const userById: DataStore["userById"] = (...a) => store().userById(...a);
export const setMembership: DataStore["setMembership"] = (...a) => store().setMembership(...a);
export const balance: DataStore["balance"] = (...a) => store().balance(...a);
export const addLedger: DataStore["addLedger"] = (...a) => store().addLedger(...a);
export const ledgerFor: DataStore["ledgerFor"] = (...a) => store().ledgerFor(...a);
export const createJob: DataStore["createJob"] = (...a) => store().createJob(...a);
export const jobById: DataStore["jobById"] = (...a) => store().jobById(...a);
export const jobsFor: DataStore["jobsFor"] = (...a) => store().jobsFor(...a);
export const updateJob: DataStore["updateJob"] = (...a) => store().updateJob(...a);
export const storageUsedBytes: DataStore["storageUsedBytes"] = (...a) =>
  store().storageUsedBytes(...a);
export const adminData: DataStore["adminData"] = () => store().adminData();
