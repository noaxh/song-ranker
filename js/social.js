// Friends transport — thin wrappers over the same verified-token Edge Function
// channel that cloud.js uses. Every call POSTs {action, token, data}; identity is
// the server-verified Spotify id, so nothing here can be spoofed from the browser.
import * as cloud from './cloud.js';

export const profileSync   = ()        => cloud.call('profile_sync');
export const setUsername   = (name)    => cloud.call('username_set', { username: name });
export const sendRequest   = (name)    => cloud.call('friend_request', { username: name });
export const respond       = (id, ok)  => cloud.call('friend_respond', { request_id: id, accept: ok });
export const cancelRequest = (id)      => cloud.call('friend_cancel', { request_id: id });
export const removeFriend  = (fid)     => cloud.call('friend_remove', { friend_id: fid });
export const listFriends   = ()        => cloud.call('friend_list');
export const friendLibrary = (fid)     => cloud.call('friend_library', { friend_id: fid });
export const setPrivacy    = (flags)   => cloud.call('privacy_set', flags);
export const block         = (fid)     => cloud.call('block', { friend_id: fid });
export const unblock       = (fid)     => cloud.call('unblock', { friend_id: fid });
