# To-Do

## Improvement ideas

1. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode (the feature-card grid covering each app area was added; the "why not dump mode" copy is still missing).
2. Might need another organization mode which is like dump mode, but the user has some organization. For instance, user might have streams placed into year folders, but all the items in each year folder is loose.
3. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
4. Add shorts upload functionality. Needs to be able to upload to YouTube.
5. The clipping mode needs to adapt to smaller window sizes, mostly by shortening labels. Also we need to clean up the crop region properties inputs. The up and down arrows are unstyled and too big. The inputs should also be stacked and the input elements should have less padding.
6. Add a way to distinguish between livestream VODs and regular youtube video posts
7. Allow the user to change the date for any stream item. We need a warning saying the app will rename all the files in the stream item to match the new date. Perhaps the user was not able to actually stream on the scheduled date, but they still want to keep the stream item and just change the date to match the actual stream date. If the date passed, the stream item is locked and the user has to create a new stream item and move the videos over through their OS explorer.
8. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
9. If a user updates the root stream directory in the settings page, and the app detects no _meta.json file. We need to force the user through the onboarding process again.
10. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
11. Need to rebuild / significantly upgrade the bulk archive process to take into account the player & clips functionality. For instance, if the user chooses to append all the video files with "-archive" or something, all the relationships with the clips and their source files will be broken. The archive process needs to take this into account and make sure the _meta.json is updated to adjust the paths to the new filenames.
12. Rename the comments feature in the stream items to "Notes" instead. Also update the How to Use section.
13. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
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

## Bugs

1. The fill color selector in the thumbnail editor is rendering wrong.
2. The create stream button in the MetaModal should be removed since it moves the user to the thumbnails page and closes the MetaModal, which causes the user to lose any unsaved changes they had in the MetaModal.
