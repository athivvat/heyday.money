import { ImageResponse } from '@vercel/og'
import socialCard from '../heyday-money.png?inline'

export function createOgImage() {
  // Embed the source image so deployed functions need no filesystem or network fetch.
  return new ImageResponse(
    <img src={socialCard} alt="" width={1200} height={630} />,
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    },
  )
}
