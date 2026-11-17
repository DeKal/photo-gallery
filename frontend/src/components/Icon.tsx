// Thin wrapper around a Material Symbols (Outlined) glyph. Pass the icon name
// (e.g. "photo_library") as `name`.
interface Props {
  name: string;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean;
}

export default function Icon({ name, className = "", title, ...rest }: Props) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      title={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {name}
    </span>
  );
}
