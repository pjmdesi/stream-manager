# To-Do

## Improvement ideas

1. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
2. Might need another organization mode which is like dump mode, but the used has some organization. For instance, user might have streams placed into year folders, but all the items in each year folder is loose.
3. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
4. Change the app background to more of a gray color so it's more neutral. Maybe also change the main color from purple so it's not so closely matched to twitch. Maybe a blue?
5. Add memory for conversion items so that if th app restarts, the items in the queue will reappear in the converter page. (only items in the queue, not anything that was actually started/paused/canceled/errored/completed).
6. Add ability for user to name/title auto-rules tasks, in case the details are similar in some of them and they want an easy way to identify. It should be optional.
7. Add a check for quitting the app for if any conversions are currently in progress, and if so, show a confirmation dialog to the user asking if they are sure they want to quit and lose their progress on those conversions. This will help prevent users from accidentally quitting the app while they have conversions in progress, and give them a chance to cancel the quit action if they didn't mean to do it.
8. Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
9. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
10. Bleep markers in the clipper tool need to have their duration value editable by using the arrow keys. I think .1 precision.
11. Update the thumbnail Template selector in the new stream dialog to also refer to the built-in thumbnail templates. Add a checkbox which says "use built-in thumbnail creator" and when it's checked, the dropdown will show the app's list of thumbnail templates. When unchecked it will show the fields currently there now. We also need to update the settings page to add whether this checkbox is selected by default for new streams (it should be on by default if the user has not changed the setting). Then we update the wording to the current "Default thumbnail template" to "Default external thumbnail template" and add a new setting for "Default built-in thumbnail template" which will be the default template selected in the thumbnail template dropdown when the "use built-in thumbnail creator" checkbox is checked in the new stream dialog. This will make it easier for users to use the app's built-in thumbnail creator and templates, while still allowing them to use external thumbnail templates if they prefer. If no default built-in thumbnail exists, offer a "Create Thumbnail Template" button next to the default built-in thumbnail template dropdown that takes the user to the thumbnail template editor to create a new built-in thumbnail template.
12. We need to add keyboard shortcuts to the player page. Full suite, based on other video editing apps.
13. Since we now have a Session videos panel in the player page. I don't think its necessary to ask the user which video they want to open when clicking the "send to player" action button. Let's remove the modal and have the player simply open the first video in the list.
14. lighten up the waveform in the waveform track in the player for non-merged audio so its easier to see.
15. Add a series of inputs in the player clipping mode so the user can finely control the properties of the crop region. located next to the crop dropdown, it should have x, y, w, h (left position, right position, width, height). The x, y will indicate the different in the position from the center of the video to the center of the crop region (if it's to the left, x will be negative, if it's higher up, y will be negative. also add a reset button which will reset the crop to the default position: x: 0, y: 0, width/height: whatever it should be).
16. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
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

1. When the file download notification appears, it lists the app title as either "Electron" or "ffprobe" instead of "Stream Manager". I think this is because of the way the app is downloading files through the main process and sending them to the default download location, which causes the OS to show the default icon and name for the process that's doing the downloading. It would be better if it showed "Stream Manager" as the app that's downloading the file, to make it clearer to users where the download is coming from.
   1. **NEED TO TEST IN DIST VERSION**
2. When the app updates the latest youtube stream with the next upcoming stream's information, the Broadcast dropdown should update to match the new info.
   1. **NEED TO TEST ON NEXT STREAM**
3. We missed adding the clip counter to the cards layout, and need to make sure to update the text styling to match the list design.
4. The _meta.json file isn't actually marked as hidden in windows explorer. We need to discourage users from opening and modifying that, so we need to make sure it's a hidden file.
5. This isn't a bug in the app, but maybe the app could solve it. On YouTube, when a stream has completed, the app can't see a new "next" stream ID because it hasn't been created yet. The user hsa to go into the YouTube studio "Go Live" page to initialize it. Maybe there's a way the app could do that? Maybe a button that appears if the app does not detect an upcoming stream?
