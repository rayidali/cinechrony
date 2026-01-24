'use client';

export function SplashScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="flex flex-col items-center">
        <img
          src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
          alt="Cinechrony"
          className="h-24 w-24 mb-6"
        />
        <h1 className="text-4xl md:text-5xl font-headline font-bold tracking-tighter">
          Cinechrony
        </h1>
      </div>
    </div>
  );
}
