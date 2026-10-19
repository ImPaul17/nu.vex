<script lang="ts">
  import type { Member } from '@nuvex/core';
  let { member, size = 38, presence = false }: { member: Member; size?: number; presence?: boolean } = $props();
</script>

<span class="avatar" style:--avatar-color={member.color} style:width="{size}px" style:height="{size}px" style:font-size="{size * .32}px" aria-label={presence ? `${member.name}, ${member.status}` : undefined}>
  {member.initials}
  {#if presence}<span class="presence {member.status}"></span>{/if}
</span>
