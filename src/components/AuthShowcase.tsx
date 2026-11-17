import { Check } from 'lucide-react';

const BACKGROUND_VIDEO_URL = "https://www.pexels.com/fr-fr/download/video/19549330/";
const POSTER_URL = "https://images.pexels.com/photos/3184307/pexels-photo-3184307.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";

interface AuthShowcaseProps {
  title: string;
  description: string;
  benefits: string[];
}

const AuthShowcase = ({ title, description, benefits }: AuthShowcaseProps) => (
  <div className="hidden p-3 lg:flex lg:min-w-0 lg:flex-1">
    <div className="relative flex w-full flex-col justify-end overflow-hidden rounded-3xl bg-neutral-950 p-10 text-white xl:p-14">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={POSTER_URL}
        aria-hidden="true"
      >
        <source src={BACKGROUND_VIDEO_URL} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      <div className="relative max-w-md space-y-5">
        <h2 className="text-2xl font-bold leading-tight tracking-tight xl:text-3xl">{title}</h2>
        <p className="text-sm leading-relaxed text-white/75">{description}</p>
        <ul className="liquid-glass divide-y divide-white/15 overflow-hidden rounded-2xl">
          {benefits.map((benefit) => (
            <li key={benefit} className="flex items-center gap-3 px-4 py-3 text-sm font-medium">
              <Check className="h-4 w-4 shrink-0 text-primary" />
              {benefit}
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);

export default AuthShowcase;
