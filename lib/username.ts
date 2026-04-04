/**
 * Fetch World App username from wallet address (free, no API key)
 */
export async function getWorldUsername(walletAddress: string): Promise<{
  username: string | null;
  profilePicture: string | null;
}> {
  try {
    const res = await fetch(`https://usernames.worldcoin.org/api/v1/${walletAddress}`);
    if (!res.ok) return { username: null, profilePicture: null };
    const data = await res.json();
    return {
      username: data.username || null,
      profilePicture: data.profile_picture_url || data.minimized_profile_picture_url || null,
    };
  } catch {
    return { username: null, profilePicture: null };
  }
}
