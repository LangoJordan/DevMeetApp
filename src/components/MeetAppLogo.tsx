const LOGO_URL = "https://cdn.builder.io/api/v1/image/assets%2F55f07b6da3ec4ffeb4f713ee963e96b5%2Fad4d33db9c214e78b6158f0dc2e5c986?format=webp&width=800&height=1200";

const MeetAppLogo = () => (
  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-neutral-950 ring-1 ring-white/10">
    <img src={LOGO_URL} alt="Logo MeetApp" className="absolute left-[-2.3%] top-[-33.6%] w-[105.5%] max-w-none" />
  </div>
);

export default MeetAppLogo;
