package websocket

import (
	"log/slog"
	"net/http"
)

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan interface{}
	register   chan *Client
	unregister chan *Client
}

type Client struct {
	hub    *Hub
	userID string
	send   chan interface{}
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan interface{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			slog.Info("websocket client registered", "user_id", client.userID)
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case msg := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- msg:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// TODO: validate JWT token and extract user_id
	userID := "demo-user"

	client := &Client{
		hub:    h,
		userID: userID,
		send:   make(chan interface{}, 256),
	}

	h.register <- client

	// TODO: implement WebSocket upgrade and message loop
	w.WriteHeader(http.StatusOK)
}

func (h *Hub) Broadcast(msg interface{}) {
	h.broadcast <- msg
}
