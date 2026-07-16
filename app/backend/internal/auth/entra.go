package auth

// EntraIDAuth handles Microsoft Entra ID (Azure AD) OIDC authentication.
// Stub implementation — full OIDC flow requires Azure app registration.
type EntraIDAuth struct {
	tenantID string
	clientID string
}

func NewEntraIDAuth(tenantID, clientID string) *EntraIDAuth {
	return &EntraIDAuth{tenantID: tenantID, clientID: clientID}
}

// Configured reports whether Entra ID credentials are present.
func (e *EntraIDAuth) Configured() bool {
	return e.tenantID != "" && e.clientID != ""
}
