# To-Do

## Improvement ideas

1. Add shorts upload functionality. Needs to be able to upload to YouTube.
2. Add a way to distinguish between livestream VODs and regular youtube video posts
3. Allow the user to change the date for any stream item. We need a warning saying the app will rename all the files in the stream item to match the new date. Perhaps the user was not able to actually stream on the scheduled date, but they still want to keep the stream item and just change the date to match the actual stream date. If the date passed, the stream item is locked and the user has to create a new stream item and move the videos over through their OS explorer.
4. Globally, throughout the app. For modals with only information (like deleting a stream item or a clip draft), the primary button on a modal (whatever is the right-most in the footer) should automatically be focused for easy keyboard confirmation. For all other modals (modals with at least 1 input of any kind), the first input should be focused instead, to allow the user to immediately start typing without needing to click the input first.
5. If a user updates the root stream directory in the settings page, and the app detects no _meta.json file. We need to force the user through the onboarding process again.
6. Need to add keyboard shortcuts for the player page to the hot to use modal of the app.
7. Update the icon for the templates button in the stream page header to the SquareDashedText icon.
8. Update the icon for the "Minimize to tray" app window button. Let's use the ArrowDownToDot icon instead. Let's bump up the size of those window buttons by 2px in both dimensions, and reduce the spacing from the window's title bar by the same amount (1px on each side). Additionally, update the "X" button icon to be slightly larger, it looks visually like it's smaller than the square icon used for the maximize/restore button, even if it's actually the same size in the code.
9. If the user changes their root directory to a new location in the settings, let's require that the app restart to refresh any processes that are looking at the file system, and to make sure the app is running smoothly with the new directory. We can have a modal that pops up when they change the root directory setting, saying "You need to restart the app for this change to take effect. This should show when the user clicks the save button after changing the root directory, and the modal should have a "Restart Now" button that closes the app and opens it again immediately and a cancel button that just closes the modal and leaves the app open, and changes the root directory back to the old. The user must restart the app if they want to change the root directory, we can't let them change it without restarting because there are too many processes that would be affected by the change and it could cause issues if they don't restart.
10. Show the size of files that are being converted next to the encoding preset label in the individual items.
11. The "Open" item in the taskbar icon menu should be above the exit item, all the non-interactive info for the watcher and converter should be above that.
12. Add some functionality to the series section item in the info side of the action panel for stream items. Allow the user to see a list of all the other episodes in a tooltip similar to the one that opens for the video counter cell. This one should open to the right, and the user should be able to enter the tooltip. It will display all the episodes in the series (format: [episode number]: [stream item title], including the one selected, which should be highlighted and not clickable) and allow the user to jump to that item when they click on it inside the tooltip.
13. Upgrades to the player page:
    - Add ability to put markers in the video timeline with notes. These markers should be saved in the _meta.json file for the video, and they should be displayed when hovering over the timeline scrubber. This would be useful for marking important moments in the video, or moments that need editing, etc. These should be available in regular playback and in clipping mode. They should appear as small colored triangles above the track, pointing downward. Hovering on one should open an enterable tooltip with fields for: timecode, freeform notes, color (use the same color palette available for the topics/games tags), and a button to delete the marker. Left-clicking on the marker should position the playback of the video to the timecode of the marker.
    - When a screenshot is taken, this should automatically add a marker at that time with a note containing the filename of the screenshot that was just taken. Automatically colored with the neutral gray. This way the user can easily find the moment in the video where the screenshot was taken, and see any notes they made about it.
14. Upgrades to the thumbnail creator:
    - When 2 or more items are selected, they should move together when the user drags one of them, instead of just the one being dragged.
    - Add alignment options: Align to artboard (the canvas render area), and align selection (align all selected items to the position of the first selected item, which should have a thicker border for its bounding box frame to indicate it's the one that everything will align to). Alignment options should include: align left edges, align horizontal centers, align right edges, align top edges, align vertical centers, align bottom edges. These options should be buttons in the top toolbar in a separate section to the right of the snapping options. Buttons should be disabled when no items are selected, defaulting to artboard align when only 1 item is selected, and a toggle (2 buttons next to each other) to switch between artboard and selection alignment (selection alignment is only enabled when 2 or more items are selected).
    -

## Bugs

_No known bugs at the moment._

## Other ideas

1. Rename the comments feature in the stream items to "Notes" instead. Also update the How to Use section.
2. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
3. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
4. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
5. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
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