# To-Do

## Discovery

* AlternativeTo listing (after 7-day account wait)
* Product Hunt listing (when ready for a possible traffic spike)
* Slant.co listing
* dev.to / Medium / Hacker News post linking to the site
* YouTube demo video with the URL in the description

## Improvement ideas

1. When navigating away from the settings page and there are unsaved changes, show a confirmation modal asking the user if they want to save their changes, discard them, or cancel the navigation. This will help prevent accidental loss of changes.
2. Add a "reveal all" button to the header of the Integrations page that reveals all the hidden details for each integration in the list. This will allow users to quickly see all the details for each integration without having to click into each one individually. It should get the same confirmation modal as the individual "eye" buttons do in each input.
3. Add shorts upload functionality. Needs to be able to upload to YouTube.
4. In the player page, the playback controls, allow the gap between the buttons to have more spacing between them when the container is wide enough to do so. They should only have their current gap between them when the container is too narrow to fit them with more spacing.
5. Add a tooltip to the "Auto-fill" button in the Stream Relay section of the integrations page which describes what it does.
6. Add clip on twitch functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready.
7. Add some functionality to the series section item in the info side of the action panel for stream items. Allow the user to see a list of all the other episodes in a tooltip similar to the one that opens for the video counter cell. This one should open to the right, and the user should be able to enter the tooltip. It will display all the episodes in the series (format: [episode number]: [stream item title], including the one selected, which should be highlighted and not clickable) and allow the user to jump to that item when they click on it inside the tooltip.
8. Fill out converter section in help modal to describe the conversion presets in detail and about importing/exporting presets as well.
9. Add ability to delete images in the carousels on the stream item page and in the metamodal. Show a delete button next to the "Set as item thumbnail" button that turns into a confirmation/cancel pair, then when confirmed send the image to the user's recycle bin and remove it from the carousel. The button should only show for images that are not set as the thumbnail for the item.
10. Upgrade the video counter tooltip to show more info such as the videos' thumbnails & encoding info. Add ability to delete video files from that tooltip. The new tooltip should be similar to the session videos section of the player page's sidebar. In fact we should create a new component for this type of tooltip that can be reused in both places. It will show a list of videos with their thumbnail, title, and encoding info, hydration status, timecode, allow the user to click on the filename to open it in the file explorer, and also have a delete button that sends the video to the recycle bin and removes it from the list.
11. Allow editing a linked YouTube broadcast's privacy (Public / Unlisted / Private) from within the app — currently only settable at creation time (via the reschedule modal's "create YouTube livestream" flow). Needs: new `updateBroadcastStatus` service fn + `youtube:updateBroadcastStatus` IPC + preload binding, plus a small privacy selector in MetaModal next to the linked YouTube broadcast info. YouTube API supports this via `liveBroadcasts.update?part=status`.
12. Update the template modal to have a fixed size, it changes based on its content and jumps around then the different tabs have a different number of items.
13. Add an "unlinked" status for stream items that are not linked to a YouTube broadcast, and show that status in the stream items in the same place as the YouTube link info. This will help clarify that the link is missing. Same styling, but colored a light gray with a broken link icon.
14. When saving a new tags template in the metamodal, the name input should autofill with the title of the game (if provided, and if it doesn't already exist in the tag templates list), the prefilled it should be highlighted so the user can replace it immediately on typing.
15. In the thumbnail editor, allow pasting an image from the clipboard, and save it to the stream item folder as a separate image file (in whatever format makes the most sense, possibly PNG to preserve quality and transparency if it has it, no compression needed).
16. In the thumbnail editor, add a "lock aspect ratio" toggle that keeps the aspect ratio of the thumbnail the same when resizing it using the transform input values. When enabled, changing the width will automatically adjust the height to maintain the aspect ratio, and vice versa. The aspect ratio should be determined by the original dimensions of the thumbnail image when it's first added to the stream item.
17. Add a "reset" button to the thumbnail editor that resets all the transform values back to their defaults (scale: 100%, rotation: 0, position: centered).
18. In the thumbnail editor, in addition to showing the zoom level in the bottom left corner, also show buttons that allow the user to quickly set the zoom level to common values (like 100%, 75%, 50%, fit to screen, etc.) for easier use. ALso add a button that "resets" the zoom level back to 100% and centers the canvas in the editor.
19. Consider removing the additional list of thumbnail options in the metamodal that allows the user to pick which image is uploaded to YouTube. Maybe just default to whatever is used as the stream item thumbnail and just have a checkbox (checked by default) that says "Use stream item thumbnail as YouTube thumbnail" or something like that. If the user unchecks it, then show the additional options for picking a different image from the carousel to use as the YouTube thumbnail. This will simplify the UI and reduce confusion for users who don't need that level of control, while still allowing power users to customize it if they want.
20. Maybe?... Update the "new stream" version of the metamodal to automatically save the stream item as soon as the user fills anything into the title and clicks out of the input, instead of waiting for them to click the "Save" button at the bottom.
21. In the metamodal, allow the tags input textarea to expand vertically as the user types in more tags, instead of having a fixed height with a scrollbar. This will make it easier to see all the tags at once and edit them without needing to scroll within the textarea.
22. Update the tags input in the metamodal and the tag templates modal to count the characters and warn the user when they exceed YouTube's tag character limit (currently 500 characters total for all tags). This will help prevent issues with tags not being applied correctly when the user tries to use them on YouTube. The actual calculation is a bit weird, I'm not exactly sure how YouTube counts the characters, but I think it's just the total number of characters in all the tags combined, including commas and spaces. For example, this is a list of tags that I copied from YouTube. They claim it's 482 characters, but I count 433:
    ```
    Amanita Design,Creaks,Floex,Machinarium,Phonopolis,Phonopolis gameplay,Samorost,atmospheric game,avant garde,blind playthrough,cardboard game,cozy game,dystopian game,first impressions,gaming,hand drawn game,indie adventure,indie game,indie puzzle,lets play,live stream,no commentary,pc gaming,point and click,puzzle adventure,puzzle game,relaxing game,single player,stop motion game,story rich game,tectix,twitch stream,walkthrough
    ```

## Ongoing Tasks

1. Continue building out the relay functionality (waiting for full testing of phase 1, requires actual usage of new features):
   a. Phase 2 — Documentation polish (1–2 hours):
      * HelpModal — new section under YouTube integration covering setup, the active-broadcast workflow, and the streaming-app config block.
      * README — bump the "Integrations → YouTube" bullet to mention the relay; possibly a dedicated relay sub-bullet.
      * No code changes; just docs.
   b. Phase 3 — UI polish on the Integrations card (small, ~30 min):
      * The widget shows live kbps/duration/grace countdown while streaming, but the Integrations card still just shows the status pill. Could mirror the lifecycle stage + stats there too, since users on the setup page during their first stream would otherwise wonder if it's working.
      * Optional, not blocking — happy to skip if the widget visibility is enough.
   c. Phase 4 — Tech-difficulties fallback image (from your _todo.md item 6):
      * When the inbound RTMP drops, keep the outbound RTMP to YouTube alive by ffmpeg-piping a still image + silent audio until the inbound returns. Concrete spec, just a real chunk of work — restructures the relay into "always one ffmpeg connected to YouTube, swap input source when OBS comes/goes."
      * Bigger lift than the prior phases; worth doing only if you actually hit a use case in real streams.

## Bugs

1. When the user "opens" a stream item (expanding the action panel) and the item is near the bottom of the list in the streams page, the page should scroll to keep the entire action panel in view.
2. When expanding the main nav sidebar, the widget items seem to jump around a bit. I think this is because of the text wrapping as the sidebar expands, but it creates a jarring experience. Perhaps adding a no-wrap to the widget item text will help?
3. We need to lighten the text of the app in several places throughout the app UI. The text color should never be darker than text-gray-400 when it lies on the default dark background colors of the app unless there is a avery good reason (let me know if you see any such instances). Also update the window button icons to be lighter as well. This should be a hard rule going forward.
4. When pasting into the description field in the metamodal, the text comes in styled with the formatting from the source. We should strip all formatting from pasted text in that field and just paste in plain text to keep the app's styling consistent and prevent any weird formatting issues.
5. Clicking the thumbnail in a stream item row opens the action panel as well as opening the image carousel. It should not open the action panel, just the image carousel.

## Other ideas

1. Rename the comments feature in the stream items to "Notes" instead. Also update that entry in the How to Use section.
2. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
3. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
4. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
5. Maybe add a "streaming mode" that detects if there's an app that's currently recording (like OBS, Xsplit, or Streamlabs). This would allow the app to adapt in order to obscure sensitive info and perhaps even enter into a streamlined UI.
6. Relay feature ideas:
   * Add the ability to allow to the to add a "technical difficulties" fallback image so if the stream app (like OBS) crashes or the signal fails, it will instead push that image to YouTube as a backup until the stream app reconnects.
   * If it's possible to integrate Twitch's enhanced broadcast mode, allow the relay to send to multiple platforms (just Twitch and YouTube for now) at the same time
   * Allow the user to manage the editable details for each platform straight from SM. Maybe they change up what game they're playing or topic they're doing or otherwise what to flexibly update the details while streaming or right before.
7. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
**No easy way to do this right now**
    ```
    Option 3: Build the event picker yourself as a custom dock (the real answer)
    OBS supports custom browser docks, and YouTube's Live Streaming API exposes liveBroadcasts.list which returns exactly what OBS's native picker shows — your scheduled events with their bound stream keys. You build a small local web page that:

    Authenticates to the YouTube Data API (OAuth with your Google account, one-time setup).
    Calls liveBroadcasts.list to fetch your upcoming scheduled events.
    Displays them as a dropdown.
    On selection, pulls the stream key via liveStreams.list on the broadcast's bound stream.
    Pushes that key into Aitum's YouTube output via obs-websocket (which Aitum exposes settings for) — or writes directly to Aitum's plugin config file and triggers a reload.

    You host this page locally (file:// or python -m http.server), add it as a Custom Browser Dock in OBS. Now you have a native-looking dock inside OBS with your scheduled events, one click away, and Twitch stays primary the whole time.
    This is the only path that actually achieves what you described. It's a few hours of work: a single HTML page with a Google OAuth flow, three API calls, and either obs-websocket JS or a file write. Given your existing automation chops (the video processing PowerShell stuff), this is well within reach.
    Caveats on option 3:

    You need a Google Cloud project with YouTube Data API v3 enabled to get OAuth credentials. Free. One-time setup, 15 minutes.
    The YouTube Data API has a daily quota (10,000 units default). liveBroadcasts.list costs 1 unit. You won't come close.
    Aitum doesn't publicly document whether its output keys are writable via obs-websocket — it may require editing the plugin's JSON config on disk (in %APPDATA%\obs-studio\plugin_config\) and restarting OBS or toggling the output. Worth confirming before committing to this.
    If Aitum's config isn't easily hot-swappable, the fallback is writing directly to the standard OBS profile's service.json — but that file is only read by OBS's primary service, so you'd be back to needing YouTube as primary.
    ```
