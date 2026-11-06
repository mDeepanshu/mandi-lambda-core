// What legacy_update_party / legacy_insert_vasulies answer: the old server's
// response code (reported inside an HTTP 200) and its body.
export interface LegacyResult {
  code: number;
  body: unknown;
}
