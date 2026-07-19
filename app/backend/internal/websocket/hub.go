package websocket

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

// Hub maintains the set of active WebSocket clients and broadcasts messages to them
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	jwtAuth    *auth.JWTAuth
}

// Client represents a WebSocket client connection
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	userID string
	email  string
	send   chan Message
}

// Message represents a WebSocket message
type Message struct {
	Type      string    `json:"type"`      // sync_progress, extraction_progress, query_complete
	UserID    string    `json:"user_id,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
}

// SyncProgressEvent represents the payload for sync_progress events
type SyncProgressEvent struct {
	Source        string `json:"source"`        // onedrive:/site/drive or teams:/group/channel
	Status        string `json:"status"`        // IDLE, SYNC_RUNNING, SYNC_PARTIAL_HAS_MORE, SYNC_COMPLETED, SYNC_FAILED
	FilesProcessed int    `json:"files_processed"`
	TotalFiles    int    `json:"total_files"`
	PercentComplete int  `json:"percent_complete"`
	Message       string `json:"message,omitempty"`
	Error         string `json:"error,omitempty"`
}

// ExtractionProgressEvent represents the payload for extraction_progress events
type ExtractionProgressEvent struct {
	ChunkID           int    `json:"chunk_id"`
	ChunksProcessed   int    `json:"chunks_processed"`
	TotalChunks       int    `json:"total_chunks"`
	PercentComplete   int    `json:"percent_complete"`
	EntitiesExtracted int    `json:"entities_extracted"`
	Message           string `json:"message,omitempty"`
}

// QueryCompleteEvent represents the payload for query_complete events
type QueryCompleteEvent struct {
	QueryID       int     `json:"query_id"`
	Query         string  `json:"query"`
	AnswerPreview string  `json:"answer_preview"`
	Confidence    float64 `json:"confidence"`
	LatencyMs     int64   `json:"latency_ms"`
	SourceCount   int     `json:"source_count"`
	EntityCount   int     `json:"entity_count"`
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// In production, validate origin against ALLOWED_ORIGINS config
		return true
	},
}

// NewHub creates and returns a new Hub instance
func NewHub(jwtAuth *auth.JWTAuth) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		jwtAuth:    jwtAuth,
	}
}

// Run starts the hub's event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			slog.Info("websocket client registered", "user_id", client.userID, "email", client.email)

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				slog.Info("websocket client unregistered", "user_id", client.userID)
			}

		case msg := <-h.broadcast:
			// Broadcast to all connected clients
			for client := range h.clients {
				select {
				case client.send <- msg:
				default:
					// Client's send channel is full, remove client
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

// ServeWS handles WebSocket upgrade and client connection
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	// Extract and validate JWT token from query parameter
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "unauthorized: missing token", http.StatusUnauthorized)
		return
	}

	// Verify JWT token
	claims, err := h.jwtAuth.VerifyToken(token)
	if err != nil {
		http.Error(w, "unauthorized: invalid token", http.StatusUnauthorized)
		slog.Warn("websocket auth failed", "error", err.Error())
		return
	}

	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err.Error())
		return
	}

	// Create new client
	client := &Client{
		hub:    h,
		conn:   conn,
		userID: claims.UserID,
		email:  claims.Email,
		send:   make(chan Message, 256),
	}

	h.register <- client

	// Start goroutines for reading and writing
	go client.readPump()
	go client.writePump()
}

// readPump reads messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		var msg Message
		err := c.conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("websocket error", "error", err.Error(), "user_id", c.userID)
			}
			break
		}

		// Set timestamp and user ID if not already set
		msg.Timestamp = time.Now()
		msg.UserID = c.userID

		// Validate message type
		if !isValidMessageType(msg.Type) {
			slog.Warn("invalid websocket message type", "type", msg.Type, "user_id", c.userID)
			continue
		}

		// Note: incoming client messages are currently not processed
		// The hub primarily broadcasts to clients; client->server messages
		// would require additional business logic routing
	}
}

// writePump writes messages to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteJSON(msg)
			if err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Broadcast sends a message to all connected clients
func (h *Hub) Broadcast(msg Message) {
	h.broadcast <- msg
}

// BroadcastSyncProgress broadcasts a sync progress event
func (h *Hub) BroadcastSyncProgress(event SyncProgressEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	msg := Message{
		Type:      "sync_progress",
		Timestamp: time.Now(),
		Data:      data,
	}
	h.Broadcast(msg)
	return nil
}

// BroadcastExtractionProgress broadcasts an extraction progress event
func (h *Hub) BroadcastExtractionProgress(event ExtractionProgressEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	msg := Message{
		Type:      "extraction_progress",
		Timestamp: time.Now(),
		Data:      data,
	}
	h.Broadcast(msg)
	return nil
}

// BroadcastQueryComplete broadcasts a query complete event
func (h *Hub) BroadcastQueryComplete(event QueryCompleteEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	msg := Message{
		Type:      "query_complete",
		Timestamp: time.Now(),
		Data:      data,
	}
	h.Broadcast(msg)
	return nil
}

// ClientCount returns the number of currently connected clients
func (h *Hub) ClientCount() int {
	return len(h.clients)
}

// isValidMessageType validates if a message type is recognized
func isValidMessageType(msgType string) bool {
	validTypes := map[string]bool{
		"sync_progress":       true,
		"extraction_progress": true,
		"query_complete":      true,
		"ping":                true,
	}
	return validTypes[msgType]
}
