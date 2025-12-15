# MovieNight 🎬

**Because Letterboxd forgot collaborative lists exist.**

A social movie watchlist app for friends to curate and share movies together. Create collaborative lists, save the TikTok/Reel that made you want to watch something, and track your movie journey with friends.

## Live Demo

🚀 [movienight-mzng.onrender.com](https://movienight-mzng.onrender.com)

## Features

### ✅ Currently Implemented

- **Landing Page**: Neo-brutalist welcome screen with edgy copy and vibrant orange/blue color scheme
- **User Authentication**: Email/password signup and login with Firebase Auth
- **Profile Pictures**: Upload custom avatars stored on Cloudflare R2
- **Multiple Watchlists**: Create unlimited lists with custom names
- **Movie & TV Show Search**: Search millions of titles via TMDB API with ratings, cast info, and posters
- **Social Links**: Attach TikTok/Instagram/YouTube links to movies
- **Watch Status**: Toggle between "To Watch" and "Watched" states
- **Movie Details Modal**: Expandable cards showing full details, cast, and embedded social videos
- **Dark Mode**: System-aware theme toggle with light mode as default
- **Dot Pattern Background**: Subtle depth effect that adapts to light/dark modes
- **Responsive Design**: Mobile-first neo-brutalist UI with chunky borders and hard shadows

### 🚧 Coming Soon

- **Collaborative Lists**: Invite friends to add/manage movies together (up to 3 members per list)
- **Social Features**: Follow users, view their public lists, activity feed
- **Enhanced Video Embeds**: Auto-play TikTok/Reels in expanded view

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Firebase Firestore
- **Auth**: Firebase Authentication
- **File Storage**: Cloudflare R2 (for profile pictures)
- **Styling**: Tailwind CSS & shadcn/ui
- **Movie Data**: TMDB API
- **Theme**: next-themes

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore & Authentication enabled
- Cloudflare R2 bucket (for avatar uploads)
- TMDB API key

### Environment Variables

Create a `.env.local` file:

```env
# Firebase Client SDK (public)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Firebase Admin SDK (server-side, keep secret)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# TMDB API
NEXT_PUBLIC_TMDB_ACCESS_TOKEN=your_tmdb_token

# Cloudflare R2 (for avatar uploads)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://your-bucket.r2.dev
```

### Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── (auth)/              # Login/signup pages
│   ├── lists/               # User's lists page
│   ├── lists/[listId]/      # Individual list page
│   ├── profile/             # User profile page
│   ├── [username]/          # Public profile page
│   ├── actions.ts           # Server actions (Firestore writes)
│   ├── globals.css          # Global styles + dot pattern
│   ├── layout.tsx           # Root layout with ThemeProvider
│   └── page.tsx             # Landing page
├── components/
│   ├── ui/                  # shadcn components
│   ├── add-movie-form-list.tsx
│   ├── movie-card-grid.tsx
│   ├── movie-card-list.tsx
│   ├── movie-details-modal.tsx
│   ├── theme-provider.tsx
│   └── theme-toggle.tsx
├── firebase/
│   ├── index.ts             # Client SDK init & hooks
│   ├── admin.ts             # Admin SDK init
│   └── provider.tsx         # Auth context
└── lib/
    └── types.ts             # TypeScript types
```

## Design System

MovieNight uses a **neo-brutalist** design language:

- **Colors**: Blue primary (#2962FF), Orange accent for CTAs, Yellow highlights
- **Typography**: Space Grotesk (headlines) + Space Mono (body)
- **Borders**: 3px solid black on all interactive elements
- **Shadows**: Hard drop shadows (no blur) - `4px 4px 0px 0px #000`
- **Buttons**: Translate down on click to mimic physical press
- **Background**: Subtle dot pattern for depth

## Database Schema

```
users/{userId}
  - displayName, email, photoURL, createdAt, username

users/{userId}/lists/{listId}
  - name: "Weekend Binges"
  - createdAt: timestamp

users/{userId}/lists/{listId}/movies/{movieId}
  - id: "movie_123" or "tv_456" (prefixed by media type)
  - title, year, posterUrl, status, socialLink, addedAt
  - mediaType: "movie" | "tv"
```

## Contributing

This is a personal project, but feel free to fork and adapt for your own movie nights!
