<script lang="ts">
  export type IconName = 'hash' | 'volume' | 'chevron' | 'plus' | 'search' | 'users' | 'bell' | 'pin' | 'help' | 'settings' | 'mic' | 'headphones' | 'send' | 'smile' | 'attach' | 'close' | 'arrow' | 'compass' | 'inbox' | 'check' | 'globe' | 'download' | 'sun' | 'shield' | 'palette' | 'logout' | 'menu' | 'link' | 'code' | 'spark' | 'more';
  let { name, size = 20, stroke = 1.7 }: { name: IconName; size?: number; stroke?: number } = $props();
  const paths: Record<IconName, string> = {
    hash: 'M5 9h14M4 15h14M11 3 7 21M17 3l-4 18',
    volume: 'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
    chevron: 'm6 9 6 6 6-6', plus: 'M12 5v14M5 12h14',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    pin: 'm16 3 5 5-4 1-4 4v4l-6-6h4l4-4 1-4ZM2 22l6-6',
    help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    settings: 'm9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
    headphones: 'M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3v-8ZM17 13h4v8h-4v-8Z',
    send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
    smile: 'M8 9h.01M16 9h.01M8 14a4 4 0 0 0 8 0M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    attach: 'm21 11-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3l9-9',
    close: 'm6 6 12 12M6 18 18 6', arrow: 'M4 12h16m-6-6 6 6-6 6',
    compass: 'm16 8-3 5-5 3 3-5 5-3ZM22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    inbox: 'M4 3h16l2 12v6H2v-6L4 3ZM2 15h6l2 3h4l2-3h6',
    check: 'm5 12 4 4L19 6', globe: 'M2 12h20M12 2a18 18 0 0 0 0 20 18 18 0 0 0 0-20ZM22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
    palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 2-2c0-2-2-2-2-3s1-2 3-2h2a3 3 0 0 0 3-3c0-4-4-8-9-8ZM7 9h.01M12 6h.01M17 9h.01M6 14h.01',
    logout: 'M9 3H3v18h6M9 12h12m-5-5 5 5-5 5', menu: 'M3 6h18M3 12h18M3 18h18',
    link: 'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2',
    code: 'm8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
    more: 'M5 12h.01M12 12h.01M19 12h.01'
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
