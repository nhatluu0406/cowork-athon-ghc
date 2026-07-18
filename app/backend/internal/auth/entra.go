package auth

// Configured reports whether Entra ID credentials are present.
func (ea *EntraIDAuth) Configured() bool {
	return ea.tenantID != "" && ea.clientID != ""
}
