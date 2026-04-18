# To-Do

## Improvement ideas

1. Send to converter tasks for auto-rules
2. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
3. Might need another organization mode which is like dump mode, but the used has some organization. For instance, user might have streams placed into year folders, but all the items in each year folder is loose.
4. Add "How to use" page to settings with tips and best practices for using the app.
5. Arrow buttons in the edit metadata modal to easily navigate between streams without having to close the modal and click on another stream to edit it. Not sure where they should go, maybe outside the actual modal container in the overlay space on either side?
6. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
7. Maybe an alternative view for the streams page, such as a grid view instead of a list view.
8. Implement animations in the UI to improve user experience.
9.  Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
10. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
11. Allow axis constraint when moving objects in the thumbnail editor while the shift key is held, to make it easier to keep objects aligned while moving them around.
12. Attach cropping position to different clip regions so users can change where the crop is for those different regions. This will allow users to have more control over the cropping of their clips, and make it easier to ensure that important parts of the video are not cropped out when creating clips for highlights or shorts.
13. Add more cropping options like square, zooming in with any crop shape, and maybe just allow manual resizing of the crop box instead of just the preset aspect ratios. This will give users more flexibility in how they want to crop their videos for different platforms and purposes.
14. Implement a recreation of the OBS stream picker for YouTube, to allow selection of scheduled streams through OBS. The ultimate goal would be to create a new stream item in the app, and when it's time to stream, the app automatically sends OBS the details for the YouTube connection. Here is what Claude recommended:
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

1. It looks like the app is not updating the "Game title" field on YouTube with the game of the stream item when I click the "Update YouTube Info" button in the edit metadata modal.
2. When I tried to create a new stream item that has the same date as one that is already in the list, the app allowed me to click "Create stream". When I did, it closed the dialog and edited the metadata of the *already existing* stream item. It did not warn me that a stream item already existed (which it should do as soon as the date is selected in the date picker). If the date is the same as an existing stream item, the app should show a warning and not allow the user to create the stream item until they select a different date that does not already have a stream item.
3. some thumbnails are showing as broken in the stream items. I think this is when it's loading in from cloud. We should show the default "no thumbnail" graphic instead of a broken image icon if the thumbnail fails to load for some reason.
4. When the file download notification appears, it lists the app title as either "Electron" or "ffprobe" instead of "Stream Manager". I think this is because of the way the app is downloading files through the main process and sending them to the default download location, which causes the OS to show the default icon and name for the process that's doing the downloading. It would be better if it showed "Stream Manager" as the app that's downloading the file, to make it clearer to users where the download is coming from.