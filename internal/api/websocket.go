package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// HandleWebSocket upgrades connection and streams hub messages to the client.
func (s *Server) HandleWebSocket(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[api] WebSocket upgrade: %v", err)
		return
	}
	defer conn.Close()

	ch := make(chan []byte, 64)
	unsub := s.Hub.Subscribe(ch)
	defer unsub()

	done := make(chan struct{})
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				log.Printf("[api] WebSocket read: %v", err)
				close(done)
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				log.Printf("[api] WebSocket write: %v", err)
				return
			}
		}
	}
}
