package finetuning

import "database/sql"

// Versioning tracks fine-tuned model versions.
type Versioning struct {
	db *sql.DB
}

func NewVersioning(db *sql.DB) *Versioning { return &Versioning{db: db} }

// ABTestManager runs A/B experiments between model versions.
type ABTestManager struct {
	versioning *Versioning
}

func NewABTestManager(v *Versioning) *ABTestManager { return &ABTestManager{versioning: v} }
