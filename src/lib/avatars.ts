// Default avatar options for user profiles
export const DEFAULT_AVATARS = [
  {
    id: 'raccoon',
    name: 'Cozy Raccoon',
    url: 'https://i.postimg.cc/wxGQG3jH/Gemini-Generated-Image-4.jpg',
  },
  {
    id: 'cat',
    name: 'Sleepy Cat',
    url: 'https://i.postimg.cc/vBD6rL93/Google-Gemini-Image.jpg',
  },
  {
    id: 'dog',
    name: 'Fireplace Pup',
    url: 'https://i.postimg.cc/9QjNF1ww/Gemini-Generated-Image-6.jpg',
  },
  {
    id: 'owl',
    name: '3D Owl',
    url: 'https://i.postimg.cc/rmbf69LP/Gemini-Generated-Image-5.jpg',
  },
] as const;

export type DefaultAvatarId = (typeof DEFAULT_AVATARS)[number]['id'];

export function getAvatarById(id: string): (typeof DEFAULT_AVATARS)[number] | undefined {
  return DEFAULT_AVATARS.find((avatar) => avatar.id === id);
}

export function isDefaultAvatar(url: string | null | undefined): boolean {
  if (!url) return false;
  return DEFAULT_AVATARS.some((avatar) => avatar.url === url);
}
