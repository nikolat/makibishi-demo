import { npubEncode } from 'nostr-tools/nip19';
export const linkGitHub = 'https://github.com/nikolat/makibishi-demo';
export const urlToLinkEvent = 'https://nostter.app';
export const defaultRelays = [
	'wss://relay.mymt.casa/',
];
export const profileRelays = [
	'wss://purplepag.es/',
	'wss://directory.yabu.me/',
];
export const getRoboHashURL = (pubkey: string) => {
	return `https://robohash.org/${npubEncode(pubkey)}?set=set4`;
};
