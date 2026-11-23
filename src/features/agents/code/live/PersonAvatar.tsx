import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage, type AvatarSize, type AvatarTone } from "@misty/ui";
import { spacesGateway } from "../../spaces-gateway/spaces_gateway";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

function usePicture(spaceId: string | undefined, userId: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    const gateway = spacesGateway.maybe();
    if (!spaceId || !gateway) return;
    let live = true;
    void gateway.memberPicture(spaceId, userId).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [spaceId, userId]);
  return url;
}

export function PersonAvatar({
  spaceId,
  person,
  size = "sm",
  className,
}: {
  spaceId?: string;
  person: { id: string; name: string; tone: AvatarTone };
  size?: AvatarSize;
  className?: string;
}) {
  const picture = usePicture(spaceId, person.id);
  return (
    <Avatar size={size} tone={person.tone} className={className}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}
