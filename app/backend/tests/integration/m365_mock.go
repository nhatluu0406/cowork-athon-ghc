package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"
)

// MockM365Server provides a mock MS Graph API server for integration testing.
// It simulates MS Graph endpoints for OneDrive, SharePoint, and Teams without
// requiring real Microsoft 365 credentials or network access.
type MockM365Server struct {
	server  *httptest.Server
	mu      sync.RWMutex
	files   map[string]*MockFile
	sites   map[string]*MockSite
	groups  map[string]*MockGroup
	messages map[string]*MockMessage
	permissions map[string][]MockPermission
	deltaTokens map[string]string
}

// MockFile represents a file in OneDrive/SharePoint
type MockFile struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	WebURL          string    `json:"webUrl"`
	LastModified    time.Time `json:"lastModifiedDateTime"`
	Size            int64     `json:"size"`
	ParentReference *MockRef  `json:"parentReference,omitempty"`
	File            *FileData `json:"file,omitempty"`
}

// FileData represents file metadata
type FileData struct {
	MimeType string `json:"mimeType"`
}

// MockRef represents a reference to a parent
type MockRef struct {
	ID    string `json:"id"`
	Path  string `json:"path"`
	DriveID string `json:"driveId"`
}

// MockSite represents a SharePoint site
type MockSite struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	WebURL      string `json:"webUrl"`
	Drives      map[string]*MockDrive `json:"-"`
}

// MockDrive represents a SharePoint drive/library
type MockDrive struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Root  string `json:"root"`
	Items []*MockFile `json:"items,omitempty"`
}

// MockGroup represents a Microsoft 365 group (Teams)
type MockGroup struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Mail        string `json:"mail"`
	Channels    map[string]*MockChannel `json:"-"`
}

// MockChannel represents a Teams channel
type MockChannel struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	IsFavorite  bool   `json:"isFavorite"`
}

// MockMessage represents a Teams message
type MockMessage struct {
	ID            string    `json:"id"`
	Body          *MockBody `json:"body"`
	From          *MockSender `json:"from"`
	CreatedDateTime time.Time `json:"createdDateTime"`
	LastModifiedDateTime time.Time `json:"lastModifiedDateTime"`
	WebURL        string    `json:"webUrl"`
}

// MockBody represents message body content
type MockBody struct {
	ContentType string `json:"contentType"` // html, text
	Content     string `json:"content"`
}

// MockSender represents message sender information
type MockSender struct {
	User *MockUser `json:"user"`
}

// MockUser represents user information
type MockUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"mail"`
}

// MockPermission represents an access permission
type MockPermission struct {
	ID         string        `json:"id"`
	GrantedTo  *GrantedTo    `json:"grantedTo"`
	Roles      []string      `json:"roles"`
	SharePoint *SharePointRoles `json:"sharepoint,omitempty"`
}

// GrantedTo represents who a permission is granted to
type GrantedTo struct {
	User  *GrantedUser  `json:"user,omitempty"`
	Group *GrantedGroup `json:"group,omitempty"`
}

// GrantedUser represents a user receiving a permission
type GrantedUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"mail"`
}

// GrantedGroup represents a group receiving a permission
type GrantedGroup struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"mail"`
}

// SharePointRoles represents SharePoint-specific roles
type SharePointRoles struct {
	PermissionID string `json:"permissionId"`
	Level        string `json:"level"` // edit, read, owner
}

// DeltaResponse represents a delta query response
type DeltaResponse struct {
	Value        []*MockFile `json:"value"`
	DeltaLink    string      `json:"@odata.deltaLink,omitempty"`
	NextLink     string      `json:"@odata.nextLink,omitempty"`
}

// NewMockM365Server creates a new mock MS Graph server
func NewMockM365Server() *MockM365Server {
	ms := &MockM365Server{
		files:       make(map[string]*MockFile),
		sites:       make(map[string]*MockSite),
		groups:      make(map[string]*MockGroup),
		messages:    make(map[string]*MockMessage),
		permissions: make(map[string][]MockPermission),
		deltaTokens: make(map[string]string),
	}

	ms.server = httptest.NewServer(http.HandlerFunc(ms.handleRequest))
	return ms
}

// BaseURL returns the base URL of the mock server
func (ms *MockM365Server) BaseURL() string {
	return ms.server.URL
}

// Close closes the mock server
func (ms *MockM365Server) Close() {
	if ms.server != nil {
		ms.server.Close()
	}
}

// AddFile adds a mock file to the server
func (ms *MockM365Server) AddFile(file *MockFile) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.files[file.ID] = file
}

// AddSite adds a mock site to the server
func (ms *MockM365Server) AddSite(site *MockSite) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.sites[site.ID] = site
}

// AddGroup adds a mock group (Teams) to the server
func (ms *MockM365Server) AddGroup(group *MockGroup) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.groups[group.ID] = group
}

// AddMessage adds a mock message to the server
func (ms *MockM365Server) AddMessage(msg *MockMessage) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.messages[msg.ID] = msg
}

// AddPermission adds a permission to a file
func (ms *MockM365Server) AddPermission(fileID string, perm MockPermission) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.permissions[fileID] = append(ms.permissions[fileID], perm)
}

// SetDeltaToken sets the delta token for a source
func (ms *MockM365Server) SetDeltaToken(source string, token string) {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	ms.deltaTokens[source] = token
}

// GetFile retrieves a mock file by ID
func (ms *MockM365Server) GetFile(fileID string) *MockFile {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	return ms.files[fileID]
}

// GetFiles returns all mock files
func (ms *MockM365Server) GetFiles() map[string]*MockFile {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	result := make(map[string]*MockFile)
	for k, v := range ms.files {
		result[k] = v
	}
	return result
}

// handleRequest routes incoming HTTP requests to appropriate handlers
func (ms *MockM365Server) handleRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Check authorization header
	auth := r.Header.Get("Authorization")
	if auth == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	path := r.URL.Path
	query := r.URL.Query()

	// Route to appropriate handler based on path
	switch {
	// Sites endpoints
	case strings.Contains(path, "/sites"):
		ms.handleSites(w, r)
	// Drives endpoints (OneDrive/SharePoint)
	case strings.Contains(path, "/drives"):
		ms.handleDrives(w, r)
	// Files endpoints
	case strings.Contains(path, "/items"):
		ms.handleItems(w, r, query)
	// Groups endpoints (Teams)
	case strings.Contains(path, "/groups"):
		ms.handleGroups(w, r)
	// Teams channels and messages
	case strings.Contains(path, "/teams"):
		ms.handleTeams(w, r)
	// Permissions endpoints
	case strings.Contains(path, "/permissions"):
		ms.handlePermissions(w, r)
	// Delta endpoints
	case strings.Contains(path, "/delta"):
		ms.handleDelta(w, r, query)
	default:
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
	}
}

// handleSites routes SharePoint sites requests
func (ms *MockM365Server) handleSites(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	sites := make([]*MockSite, 0, len(ms.sites))
	for _, site := range ms.sites {
		sites = append(sites, site)
	}

	response := map[string]interface{}{
		"value": sites,
	}
	json.NewEncoder(w).Encode(response)
}

// handleDrives routes OneDrive/SharePoint drive requests
func (ms *MockM365Server) handleDrives(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	drives := make([]*MockDrive, 0)
	for _, site := range ms.sites {
		for _, drive := range site.Drives {
			drives = append(drives, drive)
		}
	}

	response := map[string]interface{}{
		"value": drives,
	}
	json.NewEncoder(w).Encode(response)
}

// handleItems routes file/item requests (children, metadata, content)
func (ms *MockM365Server) handleItems(w http.ResponseWriter, r *http.Request, query map[string][]string) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	// If requesting children of an item
	if strings.Contains(r.URL.Path, "/children") {
		items := make([]*MockFile, 0, len(ms.files))
		for _, file := range ms.files {
			items = append(items, file)
		}
		response := map[string]interface{}{
			"value": items,
		}
		json.NewEncoder(w).Encode(response)
		return
	}

	// If requesting content
	if strings.Contains(r.URL.Path, "/content") {
		// Return a mock file content
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("mock file content"))
		return
	}

	// Default: return single item metadata
	if len(ms.files) > 0 {
		for _, file := range ms.files {
			json.NewEncoder(w).Encode(file)
			return
		}
	}

	http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
}

// handleGroups routes Microsoft 365 groups (Teams) requests
func (ms *MockM365Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	groups := make([]*MockGroup, 0, len(ms.groups))
	for _, group := range ms.groups {
		groups = append(groups, group)
	}

	response := map[string]interface{}{
		"value": groups,
	}
	json.NewEncoder(w).Encode(response)
}

// handleTeams routes Teams-specific requests (channels, messages)
func (ms *MockM365Server) handleTeams(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	// If requesting messages
	if strings.Contains(r.URL.Path, "/messages") {
		messages := make([]*MockMessage, 0, len(ms.messages))
		for _, msg := range ms.messages {
			messages = append(messages, msg)
		}
		response := map[string]interface{}{
			"value": messages,
		}
		json.NewEncoder(w).Encode(response)
		return
	}

	// If requesting channels
	if strings.Contains(r.URL.Path, "/channels") {
		channels := make([]*MockChannel, 0)
		for _, group := range ms.groups {
			for _, channel := range group.Channels {
				channels = append(channels, channel)
			}
		}
		response := map[string]interface{}{
			"value": channels,
		}
		json.NewEncoder(w).Encode(response)
		return
	}

	http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
}

// handlePermissions routes permission requests
func (ms *MockM365Server) handlePermissions(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	// Extract file ID from path (e.g., /items/{id}/permissions)
	parts := strings.Split(r.URL.Path, "/")
	var fileID string
	for i, part := range parts {
		if part == "items" && i+1 < len(parts) {
			fileID = parts[i+1]
			break
		}
	}

	if fileID == "" {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}

	perms := ms.permissions[fileID]
	response := map[string]interface{}{
		"value": perms,
	}
	json.NewEncoder(w).Encode(response)
}

// handleDelta routes delta query requests
func (ms *MockM365Server) handleDelta(w http.ResponseWriter, r *http.Request, query map[string][]string) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	files := make([]*MockFile, 0, len(ms.files))
	for _, file := range ms.files {
		files = append(files, file)
	}

	deltaToken := "next_delta_token_" + time.Now().Format("20060102150405")
	response := DeltaResponse{
		Value:     files,
		DeltaLink: "?$deltatoken=" + deltaToken,
	}

	json.NewEncoder(w).Encode(response)
}

// NewMockFile creates a new mock file with sensible defaults
func NewMockFile(id, name string) *MockFile {
	return &MockFile{
		ID:           id,
		Name:         name,
		WebURL:       "https://contoso.sharepoint.com/items/" + id,
		LastModified: time.Now(),
		Size:         1024,
		File: &FileData{
			MimeType: "text/plain",
		},
	}
}

// NewMockSite creates a new mock site with sensible defaults
func NewMockSite(id, name string) *MockSite {
	return &MockSite{
		ID:          id,
		DisplayName: name,
		Name:        strings.ToLower(name),
		WebURL:      "https://contoso.sharepoint.com/sites/" + strings.ToLower(name),
		Drives:      make(map[string]*MockDrive),
	}
}

// NewMockGroup creates a new mock group (Teams) with sensible defaults
func NewMockGroup(id, name string) *MockGroup {
	return &MockGroup{
		ID:          id,
		DisplayName: name,
		Mail:        strings.ToLower(name) + "@contoso.onmicrosoft.com",
		Channels:    make(map[string]*MockChannel),
	}
}

// NewMockMessage creates a new mock Teams message with sensible defaults
func NewMockMessage(id, content string) *MockMessage {
	return &MockMessage{
		ID: id,
		Body: &MockBody{
			ContentType: "html",
			Content:     content,
		},
		From: &MockSender{
			User: &MockUser{
				ID:          "user-123",
				DisplayName: "Test User",
				Email:       "test@contoso.com",
			},
		},
		CreatedDateTime:      time.Now(),
		LastModifiedDateTime: time.Now(),
		WebURL:               "https://teams.microsoft.com/messages/" + id,
	}
}

// NewMockPermission creates a new mock permission with sensible defaults
func NewMockPermission(id string, user *MockUser, roles []string) MockPermission {
	return MockPermission{
		ID: id,
		GrantedTo: &GrantedTo{
			User: &GrantedUser{
				ID:          user.ID,
				DisplayName: user.DisplayName,
				Email:       user.Email,
			},
		},
		Roles: roles,
	}
}

// MockHTTPResponse mocks an HTTP response for testing
type MockHTTPResponse struct {
	StatusCode int
	Body       interface{}
	Headers    map[string]string
}

// ToHTTPResponse converts MockHTTPResponse to *http.Response
func (m *MockHTTPResponse) ToHTTPResponse() *http.Response {
	body, _ := json.Marshal(m.Body)
	return &http.Response{
		StatusCode: m.StatusCode,
		Body:       io.NopCloser(bytes.NewBuffer(body)),
		Header:     make(http.Header),
	}
}

// GraphClientTestHelper provides utilities for testing with GraphClient
type GraphClientTestHelper struct {
	MockServer *MockM365Server
	BaseURL    string
}

// NewGraphClientTestHelper creates a new test helper
func NewGraphClientTestHelper() *GraphClientTestHelper {
	mockServer := NewMockM365Server()
	return &GraphClientTestHelper{
		MockServer: mockServer,
		BaseURL:    mockServer.BaseURL(),
	}
}

// Close closes the test helper and cleans up resources
func (h *GraphClientTestHelper) Close() {
	if h.MockServer != nil {
		h.MockServer.Close()
	}
}

// M365TestFixtures provides common test data for M365-related tests
type M365TestFixtures struct {
	MockServer *MockM365Server
	Files      []*MockFile
	Sites      []*MockSite
	Groups     []*MockGroup
	Messages   []*MockMessage
}

// NewM365TestFixtures creates test fixtures with commonly used test data
func NewM365TestFixtures() *M365TestFixtures {
	fixtures := &M365TestFixtures{
		MockServer: NewMockM365Server(),
		Files:      make([]*MockFile, 0),
		Sites:      make([]*MockSite, 0),
		Groups:     make([]*MockGroup, 0),
		Messages:   make([]*MockMessage, 0),
	}

	// Add common test sites
	marketingSite := NewMockSite("site-marketing", "Marketing")
	engSite := NewMockSite("site-engineering", "Engineering")
	fixtures.Sites = append(fixtures.Sites, marketingSite, engSite)
	fixtures.MockServer.AddSite(marketingSite)
	fixtures.MockServer.AddSite(engSite)

	// Add common test groups (Teams)
	engGroup := NewMockGroup("group-engineering", "Engineering Team")
	salesGroup := NewMockGroup("group-sales", "Sales Team")
	fixtures.Groups = append(fixtures.Groups, engGroup, salesGroup)
	fixtures.MockServer.AddGroup(engGroup)
	fixtures.MockServer.AddGroup(salesGroup)

	// Add common test files
	docFile := NewMockFile("file-doc", "project-proposal.docx")
	docFile.Size = 25000
	docFile.File.MimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

	pdfFile := NewMockFile("file-pdf", "quarterly-report.pdf")
	pdfFile.Size = 150000
	pdfFile.File.MimeType = "application/pdf"

	xlsFile := NewMockFile("file-xls", "sales-data.xlsx")
	xlsFile.Size = 50000
	xlsFile.File.MimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

	fixtures.Files = append(fixtures.Files, docFile, pdfFile, xlsFile)
	fixtures.MockServer.AddFile(docFile)
	fixtures.MockServer.AddFile(pdfFile)
	fixtures.MockServer.AddFile(xlsFile)

	// Add permissions to files
	user1 := &MockUser{ID: "user-1", DisplayName: "Alice Johnson", Email: "alice@contoso.com"}
	user2 := &MockUser{ID: "user-2", DisplayName: "Bob Smith", Email: "bob@contoso.com"}

	alicePerm := NewMockPermission("perm-1", user1, []string{"read", "write"})
	bobPerm := NewMockPermission("perm-2", user2, []string{"read"})

	fixtures.MockServer.AddPermission("file-doc", alicePerm)
	fixtures.MockServer.AddPermission("file-doc", bobPerm)
	fixtures.MockServer.AddPermission("file-pdf", alicePerm)

	// Add test messages
	msg1 := NewMockMessage("msg-1", "<p>Project kickoff scheduled for next Monday.</p>")
	msg2 := NewMockMessage("msg-2", "<p>Please review the attached proposal and provide feedback.</p>")
	fixtures.Messages = append(fixtures.Messages, msg1, msg2)
	fixtures.MockServer.AddMessage(msg1)
	fixtures.MockServer.AddMessage(msg2)

	return fixtures
}

// Close cleans up all resources
func (f *M365TestFixtures) Close() {
	if f.MockServer != nil {
		f.MockServer.Close()
	}
}

// FindFile finds a file in the fixtures by ID
func (f *M365TestFixtures) FindFile(fileID string) *MockFile {
	for _, file := range f.Files {
		if file.ID == fileID {
			return file
		}
	}
	return nil
}

// FindSite finds a site in the fixtures by ID
func (f *M365TestFixtures) FindSite(siteID string) *MockSite {
	for _, site := range f.Sites {
		if site.ID == siteID {
			return site
		}
	}
	return nil
}

// FindGroup finds a group in the fixtures by ID
func (f *M365TestFixtures) FindGroup(groupID string) *MockGroup {
	for _, group := range f.Groups {
		if group.ID == groupID {
			return group
		}
	}
	return nil
}

// AddCustomFile adds a custom file to the fixtures
func (f *M365TestFixtures) AddCustomFile(id, name string, size int64, mimeType string) *MockFile {
	file := NewMockFile(id, name)
	file.Size = size
	file.File.MimeType = mimeType
	f.Files = append(f.Files, file)
	f.MockServer.AddFile(file)
	return file
}

// AddFileWithPermissions adds a file and sets up permission access for users
func (f *M365TestFixtures) AddFileWithPermissions(id, name string, userPermissions map[string][]string) *MockFile {
	file := NewMockFile(id, name)
	f.Files = append(f.Files, file)
	f.MockServer.AddFile(file)

	// Add permissions for each user
	for email, roles := range userPermissions {
		user := &MockUser{
			ID:          "user-" + strings.ReplaceAll(email, "@", "-"),
			DisplayName: email,
			Email:       email,
		}
		perm := NewMockPermission("perm-"+id+"-"+user.ID, user, roles)
		f.MockServer.AddPermission(id, perm)
	}

	return file
}

// CreateTeamWithChannels creates a team (group) with channels
func (f *M365TestFixtures) CreateTeamWithChannels(groupID, groupName string, channelNames []string) *MockGroup {
	group := NewMockGroup(groupID, groupName)
	for i, chName := range channelNames {
		channel := &MockChannel{
			ID:          "channel-" + groupID + "-" + string(rune(i)),
			DisplayName: chName,
			Description: chName + " channel",
			IsFavorite:  i == 0, // First channel is favorite
		}
		group.Channels[channel.ID] = channel
	}
	f.Groups = append(f.Groups, group)
	f.MockServer.AddGroup(group)
	return group
}
