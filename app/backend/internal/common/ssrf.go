package common

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ValidateURL performs SSRF validation on a user-provided URL
// Blocks: private IP ranges, localhost, link-local addresses, and non-HTTP(S) schemes
func ValidateURL(rawURL string) error {
	if rawURL == "" {
		return nil // Empty URL is allowed (will use provider defaults)
	}

	// Parse URL
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL format: %w", err)
	}

	// Check scheme (only https allowed, http blocked for security)
	if parsedURL.Scheme != "https" {
		return fmt.Errorf("only HTTPS URLs are allowed, got: %s", parsedURL.Scheme)
	}

	// Extract hostname
	hostname := parsedURL.Hostname()
	if hostname == "" {
		return fmt.Errorf("URL must have a hostname")
	}

	// Block localhost and common localhost aliases
	if isLocalhost(hostname) {
		return fmt.Errorf("localhost URLs are not allowed")
	}

	// Resolve hostname to IP addresses
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("failed to resolve hostname %s: %w", hostname, err)
	}

	if len(ips) == 0 {
		return fmt.Errorf("hostname %s does not resolve to any IP", hostname)
	}

	// Check all resolved IPs
	for _, ip := range ips {
		if err := validateIP(ip); err != nil {
			return fmt.Errorf("hostname %s resolves to blocked IP %s: %w", hostname, ip.String(), err)
		}
	}

	return nil
}

// isLocalhost checks if hostname is localhost or a common alias
func isLocalhost(hostname string) bool {
	lowercase := strings.ToLower(hostname)
	localhostAliases := []string{
		"localhost",
		"localhost.localdomain",
		"127.0.0.1",
		"::1",
		"0.0.0.0",
		"::",
	}
	for _, alias := range localhostAliases {
		if lowercase == alias {
			return true
		}
	}
	return false
}

// validateIP checks if an IP address is in a blocked range
func validateIP(ip net.IP) error {
	// Block private IPv4 ranges (RFC 1918)
	privateRanges := []string{
		"10.0.0.0/8",     // 10.0.0.0 - 10.255.255.255
		"172.16.0.0/12",  // 172.16.0.0 - 172.31.255.255
		"192.168.0.0/16", // 192.168.0.0 - 192.168.255.255
	}

	for _, cidr := range privateRanges {
		_, ipnet, _ := net.ParseCIDR(cidr)
		if ipnet.Contains(ip) {
			return fmt.Errorf("private IP address not allowed: %s", ip.String())
		}
	}

	// Block loopback (127.0.0.0/8)
	_, loopback, _ := net.ParseCIDR("127.0.0.0/8")
	if loopback.Contains(ip) {
		return fmt.Errorf("loopback IP address not allowed: %s", ip.String())
	}

	// Block link-local (169.254.0.0/16)
	_, linkLocal, _ := net.ParseCIDR("169.254.0.0/16")
	if linkLocal.Contains(ip) {
		return fmt.Errorf("link-local IP address not allowed: %s", ip.String())
	}

	// Block IPv6 loopback (::1/128)
	if ip.IsLoopback() {
		return fmt.Errorf("loopback IP address not allowed: %s", ip.String())
	}

	// Block IPv6 link-local (fe80::/10)
	if ip.IsLinkLocalUnicast() {
		return fmt.Errorf("link-local IP address not allowed: %s", ip.String())
	}

	// Block IPv6 unique local addresses (fc00::/7)
	_, ipv6ULA, _ := net.ParseCIDR("fc00::/7")
	if ip.To16() != nil && ipv6ULA.Contains(ip) {
		return fmt.Errorf("IPv6 unique local address not allowed: %s", ip.String())
	}

	// Block multicast addresses
	if ip.IsMulticast() {
		return fmt.Errorf("multicast IP address not allowed: %s", ip.String())
	}

	// Block unspecified addresses (0.0.0.0, ::)
	if ip.IsUnspecified() {
		return fmt.Errorf("unspecified IP address not allowed: %s", ip.String())
	}

	return nil
}
