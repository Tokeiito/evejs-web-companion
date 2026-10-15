<script lang="ts">
  // The client's Folder Information (bookmarks/linkedBookmarkFolderWindow.py LinkedBookmarkFolderWindow), for a folder
  // the pilot knows, from a folder's menu (bookmarksPanel.py ShowBookmarkFolderInfo; bookmarkSvc.ShowBookmarkFolderInfo,
  // 546 to 562, on the folder as the client keeps it, nothing asked):
  //
  //   "Folder Information": "Folder Name:" and the name; Type; a shared folder's Your Access (Admin, Manage, Use or View
  //   Access, else Unknown) and Creator (the creator's name, its Show Info); an online folder's Locations and
  //   Subfolders (how many of each the client has of it); a shared folder's Access Configuration, its Admin, Manage,
  //   Use and View Access each an access list's link or "-"; Status, Online or Offline; Notes, read only; Online Folder
  //   or Offline Folder, and Close.
  //
  // An access list's name is the one the client's link shows (ownergroups/client/link.py get_access_group_name): the
  // pilot's lists as GetMyGroups answers them, any other asked of the server by its number (GetGroupInfoFromID with
  // fetchToServer: ownerGroupManager.GetGroup).
  //
  // Not here: a folder the pilot does not know (the window's Add Folder from a folder's link: AddToKnownFolders), the
  // access list's own window its link opens, and the folder's icon dragged to make a link.
  import { onMount } from "svelte";
  import { plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import type { AccessGroup, ActiveBookmarks, BookmarkFolder } from "../bridge/bookmarks.ts";
  import { accessGroupLabel, accessGroupName, isNpcCorporation } from "./accessGroupNames.ts";
  import { showInfo } from "./showInfo.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow, active, folder, onSetOnline, onClose }: {
    store: ClientStore;
    flow: AppFlow;
    active: ActiveBookmarks;
    folder: BookmarkFolder;
    onSetOnline: (isActive: boolean) => void;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  /** The window's words (linkedBookmarkFolderWindow.py 38 to 158). */
  const WORDS = {
    title: "UI/AclBookmarks/FolderInformation",
    nameHeader: "UI/AclBookmarks/FolderNameHeader",
    type: "UI/AclBookmarks/FolderType",
    personal: "UI/AclBookmarks/PersonalFolderType",
    shared: "UI/AclBookmarks/SharedFolderType",
    yourAccess: "UI/AclBookmarks/YourAccess",
    admin: "UI/AclBookmarks/AdminAccess",
    manage: "UI/AclBookmarks/ManageAccess",
    use: "UI/AclBookmarks/UseAccess",
    view: "UI/AclBookmarks/ViewAccess",
    unknown: "UI/Common/Unknown",
    creator: "UI/AclBookmarks/Creator",
    locations: "UI/PeopleAndPlaces/Locations",
    subfolders: "UI/AclBookmarks/Subfolders",
    accessConfiguration: "UI/AclBookmarks/AccessConfiguration",
    status: "UI/AclBookmarks/Status",
    online: "UI/AclBookmarks/Active",
    offline: "UI/AclBookmarks/NotActive",
    notes: "UI/PeopleAndPlaces/Notes",
    onlineFolder: "UI/AclBookmarks/MarkFolderActive",
    offlineFolder: "UI/AclBookmarks/MarkFolderAsInactive",
    close: "UI/Common/Close",
  } as const;
  /** appConst's access levels. */
  const ACCESS_LEVEL_WORDS: Readonly<Record<number, readonly [string, string]>> = {
    5: [WORDS.admin, "Runs it"],
    4: [WORDS.manage, "Changes it all"],
    3: [WORDS.use, "Adds to it"],
    2: [WORDS.view, "Sees it"],
  };

  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(template) : own;
  }

  let groups = $state<readonly AccessGroup[]>([]);

  /** An access list's link's words (AddAccessGroupRow, 150 to 158): its name, or "-" where there is none. */
  function listLine(groupID: number | null): string {
    if (groupID === null) return "-";
    const group = groups.find((each) => each.groupID === groupID);
    if (group === undefined) return "-";
    return accessGroupName(group, (id) => resolvedName($names.resolved, "owner", id, group.name), (path) => word(path, path));
  }

  // The rows' counts (101 to 110): the client's bookmarks and subfolders of an online folder.
  // svelte-ignore state_referenced_locally
  const placeCount = active.bookmarks.filter((bookmark) => bookmark.folderID === folder.folderID).length;
  // svelte-ignore state_referenced_locally
  const subfolderCount = active.subfolders.filter((subfolder) => subfolder.folderID === folder.folderID).length;

  onMount(() => {
    flow.requestWords([...Object.values(WORDS)]);
    if (folder.creatorID !== null) flow.requestNames([{ kind: "owner", id: folder.creatorID }]);
    if (folder.isPersonal) return;
    // The lists' names: the pilot's, then any other by its number.
    const wanted = [folder.adminGroupID, folder.manageGroupID, folder.useGroupID, folder.viewGroupID]
      .filter((id, at, all): id is number => id !== null && all.indexOf(id) === at);
    void flow.readAccessGroups().then(async (mine) => {
      const known = new Set(mine.map((group) => group.groupID));
      const others = (await Promise.all(wanted.filter((id) => !known.has(id)).map((id) => flow.readAccessGroup(id).catch(() => null))))
        .filter((group): group is AccessGroup => group !== null);
      groups = [...mine, ...others];
      const npc = groups.map((group) => group.creatorID).filter(isNpcCorporation);
      if (npc.length > 0) flow.requestNames(npc.map((id) => ({ kind: "owner" as const, id })));
      const labels = groups.map(accessGroupLabel).filter((path): path is string => path !== null);
      if (labels.length > 0) flow.requestWords(labels);
    }).catch(() => {
      // The lists go unnamed ("-"), as a link whose list could not be found does.
    });
  });

  const accessLine = $derived.by(() => {
    const level = ACCESS_LEVEL_WORDS[folder.accessLevel];
    return level === undefined ? word(WORDS.unknown, "Not known") : word(level[0], level[1]);
  });
</script>

<section class="folder-info" aria-label={word(WORDS.title, "About the folder")}>
  <h3>{word(WORDS.title, "About the folder")}</h3>
  <p>{word(WORDS.nameHeader, "Name:")} <strong>{folder.folderName}</strong></p>
  <dl class="folder-info-rows">
    <dt>{word(WORDS.type, "Kind")}</dt>
    <dd>{folder.isPersonal ? word(WORDS.personal, "Yours") : word(WORDS.shared, "Shared")}</dd>
    {#if !folder.isPersonal}
      <dt>{word(WORDS.yourAccess, "What you may do")}</dt>
      <dd>{accessLine}</dd>
      <dt>{word(WORDS.creator, "Made by")}</dt>
      <dd>
        {#if folder.creatorID !== null}
          {@const creatorID = folder.creatorID}
          <button type="button" class="linkish" onclick={() => showInfo({ kind: "character", characterID: creatorID })}>{resolvedName($names.resolved, "owner", creatorID, "")}</button>
        {/if}
      </dd>
    {/if}
    {#if folder.isActive}
      <dt>{word(WORDS.locations, "Places")}</dt>
      <dd>{placeCount}</dd>
      <dt>{word(WORDS.subfolders, "Subfolders")}</dt>
      <dd>{subfolderCount}</dd>
    {/if}
    {#if !folder.isPersonal}
      <dt class="folder-info-heading">{word(WORDS.accessConfiguration, "Who may do what")}</dt>
      <dd></dd>
      <dt>{word(WORDS.admin, "Runs it")}</dt>
      <dd>{listLine(folder.adminGroupID)}</dd>
      <dt>{word(WORDS.manage, "Changes it all")}</dt>
      <dd>{listLine(folder.manageGroupID)}</dd>
      <dt>{word(WORDS.use, "Adds to it")}</dt>
      <dd>{listLine(folder.useGroupID)}</dd>
      <dt>{word(WORDS.view, "Sees it")}</dt>
      <dd>{listLine(folder.viewGroupID)}</dd>
    {/if}
    <dt>{word(WORDS.status, "State")}</dt>
    <dd>{folder.isActive ? word(WORDS.online, "Online") : word(WORDS.offline, "Offline")}</dd>
  </dl>
  <label class="folder-info-notes">
    {word(WORDS.notes, "Notes")}
    <textarea rows="3" readonly value={folder.description}></textarea>
  </label>
  <p class="controls">
    {#if folder.isActive}
      <button type="button" class="primary" onclick={() => onSetOnline(false)}>{word(WORDS.offlineFolder, "Take it offline")}</button>
    {:else}
      <button type="button" class="primary" onclick={() => onSetOnline(true)}>{word(WORDS.onlineFolder, "Bring it online")}</button>
    {/if}
    <button type="button" class="minor" onclick={onClose}>{word(WORDS.close, "Close")}</button>
  </p>
</section>

<style>
  .folder-info {
    border: 1px solid currentColor;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .folder-info-rows {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.15rem 0.75rem;
    margin: 0.25rem 0;
  }
  .folder-info-rows dd {
    margin: 0;
  }
  .folder-info-heading {
    font-weight: 600;
  }
  .folder-info-notes {
    display: block;
  }
  .folder-info-notes textarea {
    width: 100%;
    font: inherit;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    text-decoration: underline;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
</style>
