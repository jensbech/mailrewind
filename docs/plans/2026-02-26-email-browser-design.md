# Google Takeout Email Browser - Design Document

## Overview
A full-stack web application that ingests Google Takeout MBOX email exports and provides an offline-first browsing, searching, and filtering interface without requiring a Google account.

## Architecture

### Technology Stack
- **Backend:** Node.js + Express
- **Database:** SQLite (self-contained, zero dependencies)
- **Frontend:** React + TypeScript
- **Email Parser:** mailparser (handles MBOX format)
- **Search:** SQLite full-text search (FTS)

### Core Components

#### 1. Email Indexer
- One-time process on app startup
- Parses `/Users/home/Downloads/Takeout/Mail/All mail Including Spam and Trash.mbox`
- Extracts: From, To, CC, BCC, Subject, Date, Body, HTML
- Stores in SQLite with full-text search index
- Progress tracking for large mailboxes

#### 2. Backend API (Express)
- `GET /api/emails` - List emails with pagination
- `GET /api/emails/:id` - Get full email content
- `GET /api/search` - Full-text search with filters
- `GET /api/stats` - Email statistics (count, date range, senders)

#### 3. Frontend (React)
- Email list view with infinite scroll
- Search bar with filters (date range, sender, recipient)
- Email detail view with HTML rendering
- Responsive design for desktop and mobile
- Thread grouping (emails with same subject)

## Data Schema

```
emails table:
- id (integer, primary key)
- messageId (string, unique)
- from (string)
- to (text)
- cc (text)
- bcc (text)
- subject (text)
- date (datetime)
- bodyText (text, indexed)
- bodyHTML (text)
- rawHeaders (text)
- timestamp (datetime)
```

## User Flows

1. **App Startup:** Index MBOX → Show stats → Ready
2. **Browse:** View paginated email list, click to read
3. **Search:** Type query → Instant full-text results
4. **Filter:** By date range, sender → Refined results

## Success Criteria
- All emails successfully parsed and indexed
- Search returns results in <500ms
- Can handle 10,000+ emails smoothly
- Works completely offline
- Clean, responsive UI

## Implementation Phases
1. Project setup + MBOX parser
2. SQLite schema + indexing logic
3. Express API
4. React frontend
5. Testing + polish
