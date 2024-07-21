<script lang='ts'>
import type { NostrEvent } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';
import type { Filter } from 'nostr-tools/filter';
import { SimplePool } from 'nostr-tools/pool';
import { insertEventIntoAscendingList, normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { getGeneralEvents, sendReaction } from '$lib/utils';
import { defaultRelays, getRoboHashURL, linkGitHub, profileRelays, urlToLinkEvent } from '$lib/config';
import { onMount } from 'svelte';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
// @ts-ignore
import type { BaseEmoji } from '@types/emoji-mart';

let pool: SimplePool;
let reactionEvents: NostrEvent[] = [];
let profiles: Map<string, NostrEvent> = new Map<string, NostrEvent>();
let targetURL: string;
let npub: string;
let emojiPicker: HTMLElement;
let emojiPickerVisible: Boolean;
let customEmojiMap: Map<string, string>;
let isGettingCustomEmojis: boolean = false;

const getReactions = async (url: string): Promise<void> => {
	if (!URL.canParse(url))
		return;
	const kind7events = await getGeneralEvents(pool, defaultRelays, [{ kinds: [7], '#r': [url] }], (event: NostrEvent) => {
		if (!reactionEvents.some(ev => ev.id === event.id)) {
			reactionEvents = insertEventIntoAscendingList(reactionEvents, event);
		}
	});
	const pubkeys: string[] = kind7events.map(ev => ev.pubkey);
	const kind0events = await getGeneralEvents(pool, profileRelays, [{ kinds: [0], authors: pubkeys }], (event: NostrEvent) => {
		const prof = profiles.get(event.pubkey);
		if (prof === undefined || prof.created_at < event.created_at) {
			try {
				const obj = JSON.parse(event.content);
			} catch (error) {
				console.warn(error);
				return;
			}
			profiles.set(event.pubkey, event);
			profiles = profiles;
		}
	});
};

const callSendReaction = async () => {
	await sendReaction(pool, defaultRelays, window.location.href, '⭐');
	await getReactions(window.location.href);//本来は不要 wss://relay.mymt.casa/ 用処理
};

const callSendEmoji = () => {
	emojiPickerVisible = !emojiPickerVisible;
	if (emojiPicker.children.length > 0) {
		return;
	}
	const onEmojiSelect = async (emoji: BaseEmoji) => {
		await sendReaction(pool, defaultRelays, targetURL, emoji.native ?? (emoji as any).shortcodes as string, (emoji as any).src as string);
		emojiPickerVisible = false;
		await getReactions(window.location.href);//本来は不要 wss://relay.mymt.casa/ 用処理
	};
	const picker = new Picker({
		data,
		custom: [
			{
				id: 'custom-emoji',
				name: 'Custom Emojis',
				emojis: Array.from(customEmojiMap.entries()).map(([shortcode, url]) => {return {
					id: shortcode,
					name: shortcode,
					keywords: [shortcode],
					skins: [{shortcodes: `:${shortcode}:`, src: url}],
				};})
			}
		],
		onEmojiSelect
	});
	emojiPicker.appendChild(picker as any);
};

const getNpubWithNIP07 = async (): Promise<void> => {
	const nostr = window.nostr;
	let pubkey: string | undefined;
	if (nostr?.getPublicKey) {
		try {
			pubkey = await nostr.getPublicKey();
		} catch (error) {
			console.error(error);
			return;
		}
		npub = nip19.npubEncode(pubkey);
	}
	if (pubkey !== undefined && nostr?.getRelays) {
		let rr: RelayRecord;
		try {
			rr = await nostr.getRelays();
		} catch (error) {
			console.error(error);
			return;
		}
		const relays: string[] = [];
		for (const [k, v] of Object.entries(rr)) {
			if (v.read && URL.canParse(k))
				relays.push(normalizeURL(k));
		}
		if (relays.length > 0) {
			npub = nip19.nprofileEncode({pubkey, relays})
		}
	}
	await getCustomEmojis();
};

const getCustomEmojis = async (): Promise<void> => {
	if (npub.length === 0)
		return;
	let dr;
	try {
		dr = nip19.decode(npub);
	} catch (error) {
		console.error(error);
		return;
	}
	let pubkey: string;
	let relaySet = new Set<string>(defaultRelays);
	if (dr.type === 'npub') {
		pubkey = dr.data;
	}
	else if (dr.type === 'nprofile') {
		pubkey = dr.data.pubkey;
		if (dr.data.relays !== undefined) {
			for (const relay of dr.data.relays)
				relaySet.add(normalizeURL(relay));
		}
	}
	else {
		console.error(`${npub} is not npub/nprofile`);
		return;
	}
	customEmojiMap = new Map<string, string>();
	isGettingCustomEmojis = true;
	const targetPubkey = pubkey;
	const kind10002events: NostrEvent[] = await getGeneralEvents(pool, Array.from(relaySet), [{ kinds: [10002], authors: [targetPubkey] }]);
	const kind10002event: NostrEvent = kind10002events.reduce((accumulator, currentValue) => {
		return accumulator.created_at > currentValue.created_at ? accumulator : currentValue;
	});
	if (kind10002event !== undefined) {
		for (const tag of kind10002event.tags.filter(tag => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1]))) {
			if (tag.length === 2 || tag[2] === 'read') {
				relaySet.add(normalizeURL(tag[1]));
			}
		}
	}
	const kind10030events: NostrEvent[] = await getGeneralEvents(pool, Array.from(relaySet), [{ kinds: [10030], authors: [targetPubkey] }]);
	if (kind10030events.length == 0) {
		isGettingCustomEmojis = false;
		return;
	}
	const filters: Filter[] = [];
	const atags = kind10030events.reduce((a, b) => a.created_at > b.created_at ? a : b).tags.filter(tag => tag.length >= 2 && tag[0] === 'a').map(tag => tag[1]);
	for (const atag of atags) {
		const ary = atag.split(':');
		filters.push({kinds: [parseInt(ary[0])], authors: [ary[1]], '#d': [ary[2]]});
	}
	let kind30030events: NostrEvent[] = [];
	const sliceByNumber = (array: Filter[], number: number) => {
		const length = Math.ceil(array.length / number);
		return new Array(length).fill(undefined).map((_, i) => array.slice(i * number, (i + 1) * number));
	};
	for (const filterGroup of sliceByNumber(filters, 10)) {
		kind30030events = kind30030events.concat(await getGeneralEvents(pool, Array.from(relaySet), filterGroup));
	}
	for (const kind30030event of kind30030events) {
		for (const tag of kind30030event.tags.filter(tag => tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2]))) {
			customEmojiMap.set(tag[1], tag[2]);
		}
	}
	isGettingCustomEmojis = false;
};

onMount(async () => {
	pool = new SimplePool();
	customEmojiMap = new Map<string, string>();
	targetURL = window.location.href;
	await getReactions(window.location.href);
});

</script>

<svelte:head>
	<title>MAKIBISHI</title>
</svelte:head>

<header>
	<h1 data-makibishi-url="">
		<a href="./">MAKIBISHI</a>
		<span class="makibishi-container">
			<button class="makibishi-button" on:click={() => callSendReaction()} title="add star"><svg><use xlink:href="./star.svg#reaction"></use></svg></button>
			{#each reactionEvents as ev}
				{@const emojiTag = ev.tags.find(tag => tag[0] === 'emoji')}
				<span class="makibishi-unit">
				{#if profiles.has(ev.pubkey) }
					{@const prof = profiles.get(ev.pubkey)}
					{@const obj = JSON.parse(prof?.content ?? '{}')}
					{@const npub = nip19.npubEncode(ev.pubkey) }
					{@const name = obj.name ?? '' }
					<span class="makibishi-content">{#if ev.content === `:${emojiTag?.at(1) ?? ''}:`}<img src={emojiTag?.at(2)} alt={ev.content} title={ev.content} />{:else}{ ev.content }{/if}</span>
					<a class="makibishi-link" href="{urlToLinkEvent}/{npub}" target="_blank" rel="noopener noreferrer">
						<img class="makibishi-profile-picture" src={obj.picture ?? getRoboHashURL(ev.pubkey)} alt="@{name}" title="@{name}" />
					</a>
				{:else}
					<span class="makibishi-content">{#if ev.content === `:${emojiTag?.at(1) ?? ''}:`}<img src={emojiTag?.at(2)} alt={ev.content} title={ev.content} />{:else}{ ev.content }{/if}</span>
				{/if}
				</span>
			{/each}
		</span>
	</h1>
	<p>Relay: {defaultRelays.join(';')}</p>
</header>
<main>
	<h2>これは何？</h2>
	<p>任意のWebページにリアクションすることができるようにしようという試みです。<br />
		タイトル横のボタンをクリックすると⭐が付きます。(要NIP-07拡張)<br />
		Nostrイベントに対してでなく、URLに対してリアクションします。<br />
		※現時点ではNIPs違反なので、送信先リレーは絞って運用中。</p>
	<pre><code>{`{
  "kind": 7,
  "content": "⭐",
  "tags": [
    ["r", "https://example.com/"]
  ],
  ...other fields
}`}</code></pre>
	<p>⭐以外のリアクションがしたい、別のURLにリアクションしたい、といった場合は以下からどうぞ。</p>
	<dl>
		<dt><label for="target-url">Target URL</label></dt>
		<dd><input id="target-url" type="text" bind:value={targetURL} /></dd>
		<dt><label for="npub-input">npub for Custom Emoji (optional)</label></dt>
		<dd><input id="npub-input" type="text" placeholder="npub1... or nprofile1..." bind:value={npub} on:change={getCustomEmojis} /><button on:click={getNpubWithNIP07}>NIP-07</button></dd>
		<dt><label for="emoji-select">Select Emoji</label> {#if isGettingCustomEmojis}(preparing...){/if}</dt>
		<dd>
			<button id="emoji-select" class="makibishi-emoji" on:click={callSendEmoji} title="Emoji Reaction" disabled={isGettingCustomEmojis}><svg><use xlink:href="./smiled.svg#emoji"></use></svg></button>
			<div bind:this={emojiPicker} class={emojiPickerVisible ? '' : 'makibishi-hidden'}></div>
		</dd>
	</dl>
</main>
<footer><a href={linkGitHub} target="_blank" rel="noopener noreferrer">GitHub</a></footer>

<style>
span.makibishi-container {
	font-size: 16px;
}
span.makibishi-container > span.makibishi-unit a {
	text-decoration: none;
}
span.makibishi-container > span.makibishi-unit {
	position: relative;
}
span.makibishi-container > span.makibishi-unit > a.makibishi-link {
	position: absolute;
	bottom: 16px;
	left: 0;
	visibility: hidden;
}
span.makibishi-container > span.makibishi-unit:hover > a.makibishi-link {
	visibility: visible;
}
span.makibishi-container > span.makibishi-unit > span.makibishi-content > img {
	height: 16px;
}
span.makibishi-container > span.makibishi-unit > a.makibishi-link > img {
	width: 16px;
	height: 16px;
}
span.makibishi-container > button.makibishi-button {
	background-color: transparent;
	border: none;
	outline: none;
	padding: 0;
	width: 16px;
	height: 16px;
	cursor: pointer;
}
button.makibishi-emoji {
	background-color: transparent;
	border: none;
	outline: none;
	padding: 0;
	width: 24px;
	height: 24px;
	cursor: pointer;
}
span.makibishi-container > button.makibishi-button > svg {
	width: 16px;
	height: 16px;
	fill: white;
}
button.makibishi-emoji > svg {
	width: 24px;
	height: 24px;
	fill: white;
}
div.makibishi-hidden {
	display: none;
}
span.makibishi-container > button.makibishi-button:active > svg {
	fill: yellow;
}
input[type="text"] {
	width: calc(100% - 1.5em);
}
footer {
	text-align: center;
}
</style>
