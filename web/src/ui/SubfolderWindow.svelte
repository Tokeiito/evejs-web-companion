<script lang="ts">
  // The client's subfolder window (bookmarks/bookmarkSubfolderWindow.py BookmarkSubfolderWindow):
  //
  //   "New Subfolder", from Create Subfolder at the Locations window's bottom or a folder's menu: Name (forty
  //   characters) and Folder, the folders the pilot may put a subfolder in (bookmarkSvc.GetFilteredFolders, 535 to
  //   544: online, and more than viewed), personal first, then by name; the folder the menu was opened on, else the
  //   one last used (settings.char.ui bookmarkSubfolderDefaultFolder);
  //   "Edit Subfolder", from a subfolder's menu: its name, and its folder's name;
  //   Submit (Confirm, 104 to 122) refuses a name of nothing (msgPleaseTypeSomething) and one the folder has already
  //   (FolderAlreadyExists), makes the subfolder (bookmarkSvc.CreateSubfolder) or renames it (UpdateSubfolder, where
  //   the server not having it is BookmarkSubfolderNoLongerThere), and keeps the folder as the one last used.
  //
  // The folder last used is kept for the pilot in this browser, as the client keeps it in its own settings. The
  // window takes the folders as the Locations window last read them.
  import { onMount } from "svelte";
  import { formatTemplate, plainText, type TemplateArguments } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { MAX_FOLDER_NAME_LENGTH } from "../bridge/bookmarkWrites.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import type { ActiveBookmarks, BookmarkFolder, Subfolder } from "../bridge/bookmarks.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow, active, folderID = null, subfolder = null, onDone }: {
    store: ClientStore;
    flow: AppFlow;
    active: ActiveBookmarks;
    folderID?: number | null;
    subfolder?: Subfolder | null;
    onDone: (made: boolean) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  /** The window's words (bookmarkSubfolderWindow.py 29 to 74, 104 to 117). */
  const WORDS = {
    newTitle: "UI/AclBookmarks/NewSubfolder",
    editTitle: "UI/AclBookmarks/EditSubfolder",
    name: "UI/PeopleAndPlaces/Name",
    folder: "UI/PeopleAndPlaces/Folder",
    submit: "UI/Common/Submit",
    cancel: "UI/Common/Cancel",
    typeSomething: "UI/Map/MapPallet/msgPleaseTypeSomething",
    alreadyThere: "UI/Notepad/FolderAlreadyExists",
    personalFolder: "UI/AclBookmarks/PersonalFolderType",
    sharedFolder: "UI/AclBookmarks/SharedFolderType",
    gone: "dialog:BookmarkSubfolderNoLongerThere/body",
  } as const;
  /** appConst.ACCESS_VIEW: a folder only viewed takes no subfolder. */
  const ACCESS_VIEW = 2;

  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(template) : own;
  }

  function filled(label: string, own: string, args: TemplateArguments): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" ? template : own, args, {
      nameOf: (kind, id) => resolvedName($names.resolved, kind, id, ""),
    }));
  }

  const pilotID = $derived($station.online?.characterID ?? null);
  const keptFolderKey = (): string => `evejs.bookmarkSubfolderDefaultFolder.${pilotID ?? 0}`;

  function readKept(): unknown {
    try {
      const raw = globalThis.localStorage?.getItem(keptFolderKey());
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function keepFolder(id: number): void {
    try {
      globalThis.localStorage?.setItem(keptFolderKey(), JSON.stringify(id));
    } catch {
      // Not kept: the choice holds for this window's life.
    }
  }

  /** GetFolderOptions (76 to 92) over GetFilteredFolders: online, more than viewed; personal first, then by name. */
  function folderOptions(read: ActiveBookmarks): readonly BookmarkFolder[] {
    return read.folders
      .filter((folder) => folder.accessLevel !== ACCESS_VIEW && folder.isActive)
      .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.folderName.toLowerCase().localeCompare(b.folderName.toLowerCase()));
  }

  // svelte-ignore state_referenced_locally
  const options = folderOptions(active);
  // svelte-ignore state_referenced_locally
  const editedFolder = subfolder === null ? null : (active.folders.find((folder) => folder.folderID === subfolder.folderID) ?? null);

  let name = $state("");
  let chosen = $state<number | null>(null);
  let error = $state("");
  let busy = $state(false);

  onMount(() => {
    flow.requestWords([...Object.values(WORDS)]);
    if (subfolder !== null) {
      name = subfolder.subfolderName;
      chosen = subfolder.folderID;
      return;
    }
    // The folder the menu was opened on, else the one last used (ApplyAttributes, 29 to 34); the list's first where
    // it is none of those offered, as the combo shows it.
    const kept = readKept();
    const wanted = folderID ?? (typeof kept === "number" ? kept : null);
    chosen = options.some((folder) => folder.folderID === wanted) ? wanted : (options[0]?.folderID ?? null);
  });

  /** Confirm (104 to 122). */
  async function submit(): Promise<void> {
    error = "";
    const trimmed = name.trim();
    if (trimmed === "") {
      error = word(WORDS.typeSomething, "Type a name first.");
      return;
    }
    const target = subfolder !== null ? subfolder.folderID : chosen;
    if (target === null) return;
    const current = subfolder?.subfolderID ?? null;
    if (active.subfolders.some((each) => each.subfolderID !== current && each.folderID === target && each.subfolderName === trimmed)) {
      error = word(WORDS.alreadyThere, "That folder has one by that name already.");
      return;
    }
    busy = true;
    try {
      if (subfolder === null) {
        await flow.createSubfolder(target, trimmed);
      } else if (!(await flow.updateSubfolder(target, subfolder.subfolderID, trimmed))) {
        error = filled(WORDS.gone, "That subfolder is not there any more.", {});
        return;
      }
      keepFolder(target);
      onDone(true);
    } catch (cause) {
      error = isSessionLost(cause) ? "Your session ended. Pick your character again." : panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  const heading = $derived(subfolder !== null ? word(WORDS.editTitle, "Rename the subfolder") : word(WORDS.newTitle, "Make a subfolder"));
</script>

<section class="subfolder-window" aria-label={heading}>
  <h3>{heading}</h3>
  <p class="controls">
    <label>
      {word(WORDS.name, "Name")}
      <input type="text" maxlength={MAX_FOLDER_NAME_LENGTH} bind:value={name} onkeydown={(event) => { if (event.key === "Enter") void submit(); }} />
    </label>
  </p>
  <p class="controls">
    {#if subfolder === null}
      <label>
        {word(WORDS.folder, "Folder")}
        <select value={chosen === null ? "" : String(chosen)} onchange={(event) => (chosen = Number(event.currentTarget.value))}>
          {#each options as folder (folder.folderID)}
            <option value={String(folder.folderID)} title={folder.isPersonal ? word(WORDS.personalFolder, "Yours") : word(WORDS.sharedFolder, "Shared")}>{folder.folderName}</option>
          {/each}
        </select>
      </label>
    {:else}
      {word(WORDS.folder, "Folder")}:
      <span title={editedFolder?.isPersonal === false ? word(WORDS.sharedFolder, "Shared") : word(WORDS.personalFolder, "Yours")}>{editedFolder?.folderName ?? ""}</span>
    {/if}
  </p>
  {#if error}<p class="error">{error}</p>{/if}
  <p class="controls">
    <button type="button" class="primary" disabled={busy} onclick={() => void submit()}>{word(WORDS.submit, "Save")}</button>
    <button type="button" class="minor" onclick={() => onDone(false)}>{word(WORDS.cancel, "Cancel")}</button>
  </p>
</section>

<style>
  .subfolder-window {
    border: 1px solid currentColor;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
  }
</style>
