// Manual type declarations for this app's own scoped Script Includes, so server
// modules can import them the way the module-guide mandates — `import { X } from
// '@servicenow/glide/x_snc_brb_app'` — instead of the forbidden scope-prefix dot
// notation (`new x_snc_brb_app.X()`, which is undefined in a module at runtime).
//
// `now-sdk dependencies` can generate these from the instance, but it isn't wired up
// here; this is the documented fallback (module-guide "Importing a Script Include
// class with no generated type declaration fails to compile … add a manual .d.ts").
// The platform provides the real runtime binding for the import; this only supplies
// compile-time types. Keep the surface in sync with the SIs under
// src/server/script-includes/.
declare module '@servicenow/glide/x_snc_brb_app' {
    // WorkingDays (ADR 0006) — I9 Mon–Fri inclusive day counter. Pure; may return 0.
    export class WorkingDays {
        count(startDate: string, endDate: string): number
    }

    // LeaveBalance (ADR 0005) — ledger balance / held / available for an (employee,
    // leaveType) pair. `excludeRequestSysId` is the "other" in I6. Takes a server-
    // trusted `employee` only (never raw client input).
    export class LeaveBalance {
        getBalance(
            employee: string,
            leaveType: string,
            excludeRequestSysId?: string
        ): { balance: number; held: number; available: number }
        availableFor(employee: string, leaveType: string): number
    }
}
