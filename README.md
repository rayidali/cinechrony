<p align="center">
  <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Cinechrony logo" height="120">
</p>

<h1 align="center"><a href="https://cinechrony.com">Cinechrony</a></h1>

<p align="center">
  <strong>Because Letterboxd forgot collaborative lists exist.</strong>
</p>

<p align="center">
  <a href="https://cinechrony.com"><img src="https://img.shields.io/badge/waitlist-cinechrony.com-0d9488" alt="Waitlist"></a>
  <a href="https://github.com/rayidali/movienight/stargazers"><img src="https://img.shields.io/github/stars/rayidali/movienight" alt="Stars"></a>
  <a href="https://github.com/rayidali/movienight/issues"><img src="https://img.shields.io/github/issues/rayidali/movienight" alt="Issues"></a>
  <a href="https://github.com/rayidali/movienight/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rayidali/movienight" alt="License"></a>
</p>

<p align="center">
  A social movie watchlist app for friends to curate and share movies together. Create collaborative lists, save the TikTok/Reel that made you want to watch something, and track your movie journey with friends.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#screenshot">Screenshot</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Screenshot

<p align="center">
  <img src="https://i.postimg.cc/jSc0fH07/cinechrony_poster2_withbg.png" alt="Cinechrony app screenshot" width="600">
</p>

## Features

- **Collaborative Watchlists** — Invite friends to curate lists together (up to 3 members per list)
- **Social Links** — Attach TikTok, Instagram Reels, or YouTube links to any movie
- **Video Embeds** — Auto-play attached social videos directly in the app
- **Movie & TV Search** — Search millions of titles via TMDB with ratings, cast, and posters
- **Watch Status** — Toggle between "To Watch" and "Watched" states
- **Follow System** — Follow users and view their public lists
- **Dark Mode** — System-aware theme toggle
- **Neo-Brutalist UI** — Bold, chunky design with hard shadows and vibrant colors

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 15 (App Router) |
| Database | Firebase Firestore |
| Authentication | Firebase Auth |
| File Storage | Cloudflare R2 |
| Styling | Tailwind CSS, shadcn/ui |
| Movie Data | TMDB API |

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore & Authentication enabled
- Cloudflare R2 bucket (for avatar uploads)
- TMDB API key

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Firebase Client SDK
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Firebase Admin SDK (server-side)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# TMDB API
NEXT_PUBLIC_TMDB_ACCESS_TOKEN=your_tmdb_token

# Cloudflare R2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://your-bucket.r2.dev
```

### Installation

```bash
# Clone the repository
git clone https://github.com/rayidali/cinechrony.git

# Navigate to the project
cd cinechrony

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login & signup pages
│   ├── home/             # Main dashboard
│   ├── lists/            # Watchlist pages
│   ├── profile/          # User profile
│   └── [username]/       # Public profile pages
├── components/
│   ├── ui/               # shadcn components
│   └── ...               # Feature components
├── firebase/
│   ├── index.ts          # Client SDK
│   ├── admin.ts          # Admin SDK
│   └── provider.tsx      # Auth context
└── lib/
    └── types.ts          # TypeScript definitions
```

## Design System

Cinechrony uses a **neo-brutalist** design language:

| Element | Style |
|---------|-------|
| Primary Color | Blue (#2962FF) |
| Accent Color | Orange (CTAs) |
| Typography | Space Grotesk (headlines), Space Mono (body) |
| Borders | 3px solid black |
| Shadows | Hard drop shadows — `4px 4px 0px 0px #000` |
| Interactions | Physical press effect on buttons |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with coffee and questionable movie taste.
</p>
