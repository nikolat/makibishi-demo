import type { EventTemplate, NostrEvent } from 'nostr-tools/pure';
import type { SimplePool } from 'nostr-tools/pool';
import type { SubCloser } from 'nostr-tools/abstract-pool';
import type { Filter } from 'nostr-tools/filter';
import type { WindowNostr } from 'nostr-tools/nip07';
import { reactionEventKind } from '$lib/config';

declare global {
	interface Window {
		nostr?: WindowNostr;
	}
}

export const getGeneralEvents = (pool: SimplePool, relays: string[], filters: Filter[], callbackEvent: Function = () => {}): Promise<NostrEvent[]> => {
	return new Promise((resolve) => {
		let count: number = 0;
		const subs: SubCloser[] = [];
		const events: NostrEvent[] = [];
		const onevent = (ev: NostrEvent) => {
			events.push(ev);
			callbackEvent(ev);
		};
		const oneose = () => {
			count++;
			if (count >= filters.length) {
				for (const sub of subs) {
					sub.close();
				}
				resolve(events);
			}
		};
		for (const filter of filters) {
			const sub: SubCloser = pool.subscribeMany(
				relays,
				filter,
				{ onevent, oneose }
			);
			subs.push(sub);
		}
	});
};

export const sendReaction = async (pool: SimplePool, relaysToWrite: string[], targetURL: string, content: string, emojiurl?: string) => {
	const tags: string[][] = [
		['k', 'web'],
		['i', targetURL],
	];
	if (emojiurl) {
		tags.push(['emoji', content.replaceAll(':', ''), emojiurl]);
	}
	const baseEvent: EventTemplate = {
		kind: reactionEventKind,
		created_at: Math.floor(Date.now() / 1000),
		tags: tags,
		content: content
	};
	let newEvent: NostrEvent;
	if (window.nostr === undefined) {
		console.warn('window.nostr is undefined');
		return;
	}
	else {
		newEvent = await window.nostr.signEvent(baseEvent);
	}
	const pubs = pool.publish(relaysToWrite, newEvent);
	await Promise.any(pubs);
};
