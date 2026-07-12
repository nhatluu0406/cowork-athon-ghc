/**
 * Permission sub-client of the loopback service (CGHC-017, split out of {@link ./service-client}
 * in CGHC-025 to keep each file cohesive + under the size budget).
 *
 * Carries the non-secret permission wire types (mirrored from `service/src/permission/router.ts`
 * so the renderer bundle stays dependency-free of the Node-only service package) and the two
 * permission routes. It is composed into the single {@link ServiceClient} object — the public
 * import surface is unchanged: consumers still import these names from `./service-client.js`,
 * which re-exports them.
 */
/** Build the permission routes over the shared boundary `call` helper. */
export function createPermissionClient(call) {
    return {
        listPendingPermissions: async () => (await call("/v1/permission/pending")).pending,
        // The decision route always returns a success envelope (even the 404 `unknown` body), so
        // `call` resolves with the typed outcome; the controller distinguishes resolved / unknown /
        // already_resolved and never treats a non-`resolved` outcome as a fabricated success.
        decidePermission: (input) => call("/v1/permission/decision", {
            method: "POST",
            body: JSON.stringify(input),
        }),
    };
}
//# sourceMappingURL=permission-client.js.map