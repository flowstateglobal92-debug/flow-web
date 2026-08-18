import Image from "next/image";

type Props = {
  /** Basename in /art, e.g. "ic-map". */
  name: string;
  /** Rendered box size in px. */
  size?: number;
  className?: string;
  /** Stagger the shared float animation so a grid of icons doesn't bob in unison. */
  delay?: number;
};

/**
 * A Higgsfield-rendered glass object used as an icon: transparent cutout,
 * terracotta bloom behind it, gentle float. Same object language as the
 * capability cards, at icon scale.
 *
 * Place inside a `group` to get the hover bloom and lift.
 */
export default function GlassIcon({ name, size = 68, className = "", delay = 0 }: Props) {
  return (
    <span
      className={`pointer-events-none relative block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="glow-terra absolute left-1/2 top-1/2 block h-[88%] w-[88%] -translate-x-1/2 -translate-y-1/2 opacity-45 transition-opacity duration-500 group-hover:opacity-80" />
      <Image
        src={`/art/${name}.webp`}
        alt=""
        width={800}
        height={800}
        sizes={`${size}px`}
        className="float-y relative h-full w-full object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.6)] transition-transform duration-700 ease-[var(--ease-flow)] group-hover:scale-[1.08]"
        style={{ animationDelay: `${delay}s` }}
      />
    </span>
  );
}
