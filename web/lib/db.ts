import { DataStore } from "./data/types";
export type { MoneyIssue } from "./data/reconcile";

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
export const setStripeIds: DataStore["setStripeIds"] = (...a) => store().setStripeIds(...a);
export const userByStripeCustomer: DataStore["userByStripeCustomer"] = (...a) =>
  store().userByStripeCustomer(...a);
export const setResetToken: DataStore["setResetToken"] = (...a) => store().setResetToken(...a);
export const userByResetToken: DataStore["userByResetToken"] = (...a) =>
  store().userByResetToken(...a);
export const setPassword: DataStore["setPassword"] = (...a) => store().setPassword(...a);
export const balance: DataStore["balance"] = (...a) => store().balance(...a);
export const addLedger: DataStore["addLedger"] = (...a) => store().addLedger(...a);
export const ledgerFor: DataStore["ledgerFor"] = (...a) => store().ledgerFor(...a);
export const createJob: DataStore["createJob"] = (...a) => store().createJob(...a);
export const jobById: DataStore["jobById"] = (...a) => store().jobById(...a);
export const jobsFor: DataStore["jobsFor"] = (...a) => store().jobsFor(...a);
export const updateJob: DataStore["updateJob"] = (...a) => store().updateJob(...a);
export const claimJob: DataStore["claimJob"] = (...a) => store().claimJob(...a);
export const jobsInFlight: DataStore["jobsInFlight"] = (...a) => store().jobsInFlight(...a);
export const deleteJob: DataStore["deleteJob"] = (...a) => store().deleteJob(...a);
export const storageUsedBytes: DataStore["storageUsedBytes"] = (...a) =>
  store().storageUsedBytes(...a);
export const adminData: DataStore["adminData"] = () => store().adminData();
export const allUsers: DataStore["allUsers"] = (...a) => store().allUsers(...a);
export const getSystem: DataStore["getSystem"] = (...a) => store().getSystem(...a);
export const setSystem: DataStore["setSystem"] = (...a) => store().setSystem(...a);
export const moneyIssues: DataStore["moneyIssues"] = () => store().moneyIssues();
