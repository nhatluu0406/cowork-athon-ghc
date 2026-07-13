package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type JWTAuth struct {
	secret        []byte
	tokenDuration time.Duration
}

func NewJWTAuth(secret string) *JWTAuth {
	return &JWTAuth{
		secret:        []byte(secret),
		tokenDuration: 24 * time.Hour,
	}
}

type Claims struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	ObjectID    string `json:"oid"`
	jwt.RegisteredClaims
}

func (ja *JWTAuth) GenerateToken(userID, email string, expiresIn int) (string, error) {
	if expiresIn <= 0 {
		expiresIn = int(ja.tokenDuration.Seconds())
	}

	now := time.Now()
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(expiresIn) * time.Second)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "m365-knowledge-graph",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(ja.secret)
	if err != nil {
		return "", fmt.Errorf("jwt.GenerateToken: sign token: %w", err)
	}

	return tokenString, nil
}

func (ja *JWTAuth) GenerateTokenWithClaims(userID, email, displayName, objectID string, expiresIn int) (string, error) {
	if expiresIn <= 0 {
		expiresIn = int(ja.tokenDuration.Seconds())
	}

	now := time.Now()
	claims := Claims{
		UserID:      userID,
		Email:       email,
		DisplayName: displayName,
		ObjectID:    objectID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(expiresIn) * time.Second)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "m365-knowledge-graph",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(ja.secret)
	if err != nil {
		return "", fmt.Errorf("jwt.GenerateTokenWithClaims: sign token: %w", err)
	}

	return tokenString, nil
}

func (ja *JWTAuth) VerifyToken(token string) (*Claims, error) {
	claims := &Claims{}

	parsedToken, err := jwt.ParseWithClaims(token, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return ja.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("jwt.VerifyToken: parse token: %w", err)
	}

	if !parsedToken.Valid {
		return nil, errors.New("jwt.VerifyToken: invalid token")
	}

	// Check expiration
	if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("jwt.VerifyToken: token expired")
	}

	return claims, nil
}
