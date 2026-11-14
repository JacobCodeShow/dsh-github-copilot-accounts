// One browser-module pool shared by the badge controller and its owned views.
// Construction is lazy with respect to DOM/Image/timers: nothing loads until an
// avatar lease is acquired. Host/binding generations remain separate opaque keys.
import { createAvatarImageCache } from "./avatar-image-cache.mjs";
export const avatarImageCache = createAvatarImageCache();
