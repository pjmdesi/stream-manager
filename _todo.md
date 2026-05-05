# To-Do

## Improvement ideas

1. Add shorts upload functionality. Needs to be able to upload to YouTube.
2. Add clip on twitch functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready. We could also allow the user to download the clip once it's ready, since Twitch doesn't provide a direct download link for clips like YouTube does for its shorts.
3. Add a way to distinguish between livestream VODs and regular youtube video posts
4. Allow the user to change the date for any stream item. We need a warning saying the app will rename all the files in the stream item to match the new date. Perhaps the user was not able to actually stream on the scheduled date, but they still want to keep the stream item and just change the date to match the actual stream date. If the date passed, the stream item is locked and the user has to create a new stream item and move the videos over through their OS explorer.
5. Globally, throughout the app. For modals with only information (like deleting a stream item or a clip draft), the primary button on a modal (whatever is the right-most in the footer) should automatically be focused for easy keyboard confirmation. For all other modals (modals with at least 1 input of any kind), the first input should be focused instead, to allow the user to immediately start typing without needing to click the input first.
6. Add spell checker suggestions to the right click menu for all text inputs in the app. This includes the stream item title and description inputs, the comment input, and any other text input in the app. We can use a library like "electron-spellchecker" to implement this functionality.
7. The thumbnail assets panel should look for updates to the stream item folder and automatically update the list of thumbnails when new ones are added or removed.
8. If a user updates the root stream directory in the settings page, and the app detects no _meta.json file. We need to force the user through the onboarding process again.
9. If the user changes their root directory to a new location in the settings, let's require that the app restart to refresh any processes that are looking at the file system, and to make sure the app is running smoothly with the new directory. We can have a modal that pops up when they change the root directory setting, saying "You need to restart the app for this change to take effect. This should show when the user clicks the save button after changing the root directory, and the modal should have a "Restart Now" button that closes the app and opens it again immediately and a cancel button that just closes the modal and leaves the app open, and changes the root directory back to the old. The user must restart the app if they want to change the root directory, we can't let them change it without restarting because there are too many processes that would be affected by the change and it could cause issues if they don't restart.
10. Add some functionality to the series section item in the info side of the action panel for stream items. Allow the user to see a list of all the other episodes in a tooltip similar to the one that opens for the video counter cell. This one should open to the right, and the user should be able to enter the tooltip. It will display all the episodes in the series (format: [episode number]: [stream item title], including the one selected, which should be highlighted and not clickable) and allow the user to jump to that item when they click on it inside the tooltip.

## Bugs

(none)

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