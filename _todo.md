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
4. Add clip on twitch functionality. This is a bit more complex than the YouTube one, because Twitch clips are created through an API call that takes a start and end time, and then Twitch processes the clip and makes it available after a few minutes. We would need to have some kind of system for checking the status of the clip creation and updating the app when it's ready.
5. Add some functionality to the series section item in the info side of the action panel for stream items. Allow the user to see a list of all the other episodes in a tooltip similar to the one that opens for the video counter cell. This one should open to the right, and the user should be able to enter the tooltip. It will display all the episodes in the series (format: [episode number]: [stream item title], including the one selected, which should be highlighted and not clickable) and allow the user to jump to that item when they click on it inside the tooltip.
6. Fill out converter section in help modal to describe the conversion presets in detail and about importing/exporting presets as well.
7. Add ability to delete images in the carousels on the stream item page and in the metamodal. Show a delete button next to the "Set as item thumbnail" button that turns into a confirmation/cancel pair, then when confirmed send the image to the user's recycle bin and remove it from the carousel. The button should only show for images that are not set as the thumbnail for the item.
8. Upgrade the video counter tooltip to show more info such as the videos' thumbnails & encoding info. Add ability to delete video files from that tooltip. The new tooltip should be similar to the session videos section of the player page's sidebar. In fact we should create a new component for this type of tooltip that can be reused in both places. It will show a list of videos with their thumbnail, title, and encoding info, hydration status, timecode, allow the user to click on the filename to open it in the file explorer, and also have a delete button that sends the video to the recycle bin and removes it from the list.
9. Allow editing a linked YouTube broadcast's privacy (Public / Unlisted / Private) from within the app — currently only settable at creation time (via the reschedule modal's "create YouTube livestream" flow). Needs: new `updateBroadcastStatus` service fn + `youtube:updateBroadcastStatus` IPC + preload binding, plus a small privacy selector in MetaModal next to the linked YouTube broadcast info. YouTube API supports this via `liveBroadcasts.update?part=status`.
10. In the thumbnail editor, allow pasting an image from the clipboard, and save it to the stream item folder as a separate image file (in whatever format makes the most sense, possibly PNG to preserve quality and transparency if it has it, no compression needed).
11. Consider removing the additional list of thumbnail options in the metamodal that allows the user to pick which image is uploaded to YouTube. Maybe just default to whatever is used as the stream item thumbnail and just have a checkbox (checked by default) that says "Use stream item thumbnail as YouTube thumbnail" or something like that. If the user unchecks it, then show the additional options for picking a different image from the carousel to use as the YouTube thumbnail. This will simplify the UI and reduce confusion for users who don't need that level of control, while still allowing power users to customize it if they want.
12. If possible, when the user deletes a stream item, it should offer the option to also delete the linked YouTube livestream VOD or video if there is one, and if they confirm, it will delete the broadcast through the YouTube API.
13. Maybe?... Update the "new stream" version of the metamodal to automatically save the stream item as soon as the user fills anything into the title and clicks out of the input, instead of waiting for them to click the "Save" button at the bottom.
14. (Maybe?) Implement a more robust go live check for the relay when broadcasting to YouTube. From Claude:
    ```
    Add getStreamStatus(streamId) to youtubeApi.ts — calls liveStreams.list?part=status&id={streamId}, returns { streamStatus, healthStatus }. Costs 1 quota unit per call.
    Replace the retry-transition-on-timer loop with a poll-until-ready loop:
    After bindBroadcast, poll every 2s
    When streamStatus === 'active', call transition('live') once
    Overall timeout: 90s (gives plenty of headroom for slow connections, still fails gracefully)
    Emits lifecycle stages along the way so the widget can show "Waiting for YouTube to receive stream…" instead of going straight to "going live"
    ```
15. Add a text input to the topics/games filter dropdown in the streams list. Essentially a filter for the filters, which would allow the user to quickly find the topic or game they want to filter by without having to scroll through the whole list. Input should be focused when the dropdown opens, and should filter the list of topics/games in real time as the user types.
16. Add the ability to collapse the waveform tracks in the play page when multi-track playback is enabled. This would allow the user to claim back some height in the tracks section and hide tracks that may have no audio. It should be a simple toggle arrow button on the very right of the row (all the way at the end). When clicked, it should collapse the waveform track to 0px, leaving the audio control track still visible. When clicked again, it should expand the waveform track back to its original height.

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

1. In the thumbnail editor, the "This Stream" section title in the sidebar and the name of the stream are on the same row, causing the section title to wrap and causing the title to be truncated with little to see. The title should appear under the section title.
2. I didn't consider how the changes to the scheduled broadcast flow for YouTube would affect the Twitch functionality. The twitch update info functionality needs to be adjusted so that the checkbox to update twitch is only checked by default if the stream item is the next "soonest" upcoming stream item in SM. That way if the user creates more upcoming stream items after the first one, the checkbox won't be checked by default for those, since they won't be the next upcoming stream item until the previous ones have passed. We should also consider how the lifecycle will work for twitch now that it's possible for the user to schedule multiple future streams for YouTube. Once a livestream is over, something should happen that either automatically updates the twitch info with the next stream's details or tells the user that the stream details for twitch are out of date or otherwise don't match the details for the next stream item. It might be good to overhaul the twitch details in the metamodal (and other touchpoints) entirely so it's way more clear how it works and allows for more control for the different platforms. Currently the 2 platforms are intertwined with Twitch definitely taking a back seat, UI-wise (even though its the preferred platform of most streamers).
3. In the relay widget, the selected stream item did not update after the soonest upcoming stream item transitioned to a paste stream. The widget should automatically update to select the next soonest upcoming stream item when the current selected stream item transitions to past or is deleted, so that the user doesn't have to manually select the next stream item in order to see the correct info and controls for the current stream. It did autoselect the correct one when I clicked on it (didn't have to select it), but I did need to interact with it in order for it to update, which is not ideal. It should update automatically without needing any interaction from the user.

## Other ideas (small)

1. Rename the comments feature in the stream items to "Notes" instead. Also update that entry in the How to Use section.
2. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
3. Add a main process console viewer for the production version of the app, accessible with a keyboard shortcut.
4. Maybe add a "streaming mode" that detects if there's an app that's currently recording (like OBS, Xsplit, or Streamlabs). This would allow the app to adapt in order to obscure sensitive info and perhaps even enter into a streamlined UI.
5. Relay feature ideas:
   * Add the ability to allow to the to add a "technical difficulties" fallback image so if the stream app (like OBS) crashes or the signal fails, it will instead push that image to YouTube as a backup until the stream app reconnects.
   * If it's possible to integrate Twitch's enhanced broadcast mode, allow the relay to send to multiple platforms (just Twitch and YouTube for now) at the same time
   * Allow the user to manage the editable details for each platform straight from SM. Maybe they change up what game they're playing or topic they're doing or otherwise what to flexibly update the details while streaming or right before.

## Other ideas (big)

1. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
   * Not sure if it should play through the SM app or just manage the files and the metadata for the music that's played through OBS.
   * Maybe it could serve a custom web page that displays in OBS as a browser source that shows the current track info and maybe even the album art or something in a customizable layout.
   * The biggest add for me would be a way to group music items into playlists so I can easily switch between different sets of music for different types of streams or different moods. This way, I won't have to manually edit the settings of the OBS music source every time I want to change up the music.
   * Maybe one day, there could even be a feature that allows the user's audience to vote on what music they want to hear during the stream through a Twitch extension or a website. And maybe even rate the music or suggest new tracks to add to the playlists. This would be a fun way to engage with the audience and make the music selection more interactive.
