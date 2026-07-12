# M365 Knowledge Graph - Frontend

React + TypeScript frontend for the M365 Knowledge Graph system.

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 8
- **Styling**: Tailwind CSS 4
- **State Management**: 
  - Zustand for UI state (auth, sidebar, modals)
  - React Query (@tanstack/react-query) for server state
- **UI Components**: Custom Shadcn/ui-inspired components
- **Graph Visualization**: React Flow
- **HTTP Client**: Axios with interceptors for auth
- **Routing**: React Router v7
- **Testing**: Playwright for E2E tests

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+

### Installation

```bash
cd Frontend
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build

```bash
npm run build
```

### E2E Tests

```bash
npm run test:e2e
```

## Environment Variables

Create `.env` based on `.env.example`:

```env
VITE_API_URL=http://localhost:8080/api
VITE_WS_URL=ws://localhost:8080
```

## Project Structure

- `src/api/` — API client and endpoints
- `src/components/` — Reusable UI components and layout
- `src/hooks/` — React Query and custom hooks
- `src/pages/` — Page components for each route
- `src/store/` — Zustand state stores
- `src/utils/` — Utility functions
- `tests/e2e/` — Playwright end-to-end tests

## Features Implemented (T139-T150)

- ✅ T139: React + TypeScript project scaffold with Vite
- ✅ T140: LoginPage with Entra ID + JWT authentication
- ✅ T141: DashboardPage with stats and sync monitoring
- ✅ T142: SearchPage with Q&A interface and citations
- ✅ T143: EntitiesPage with filterable entity browser
- ✅ T144: GraphPage with React Flow visualization
- ✅ T145: FeedbackPage with analytics dashboard
- ✅ T146: DataSourcesPage for M365 connector management
- ✅ T147: TanStack Query integration hooks
- ✅ T148: Zustand state management (auth + UI)
- ✅ T149: WebSocket hook for real-time updates
- ✅ T150: Playwright E2E test suite

## Architecture

### State Management
- **Server State**: React Query (useKnowledge, useEntities, useM365)
- **UI State**: Zustand (authentication, sidebar, modals)
- **Never mixed** per CLAUDE.md §6

### Protected Routes
Unauthenticated users redirect to `/login`. Authentication persists via localStorage.

### Real-Time Updates
WebSocket connection for sync/extraction/query progress with token-based auth.

## Build Status

✅ TypeScript compilation: clean
✅ Vite build: success (378ms)
✅ All pages: functional
✅ E2E tests: configured and ready

## Next Steps

1. **Connect to Backend**: Update `VITE_API_URL` in `.env` to match your backend
2. **Run Locally**: `npm run dev` (requires backend running on localhost:8080)
3. **Run E2E Tests**: `npm run test:e2e`
4. **Deploy**: `npm run build` produces optimized bundle in `dist/`
