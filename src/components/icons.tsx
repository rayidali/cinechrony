import type { SVGProps } from "react";

export function TiktokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12.528 8.003c-.284-.045-.58.113-.714.419-.133.306.01.65.316.783.21.092.433.13.653.13h3.703v-4.11c0-1.02.83-1.85 1.852-1.85s1.852.83 1.852 1.85v10.278c0 1.02-.83 1.85-1.852 1.85s-1.852-.83-1.852-1.85V14.5c0-.98-.79-1.78-1.77-1.78-.97 0-1.76.77-1.76 1.74v5.04c0 1.02-.83 1.85-1.852 1.85S8.5 20.52 8.5 19.5v-5.06c0-2.58-2.1-4.68-4.68-4.68H2.5" />
    </svg>
  );
}
