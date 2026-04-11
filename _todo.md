# To-Do

1. Attachment to Youtube & Twitch posts
  a. Would look for the stream item on user's twitch / youtube channel and link to the post if found. Would also download the thumbnail and attach it to the stream item in the app.
  b. When twitch streams are automatically deleted on the website, app would indicate as such and recommend to use the app's archive process.
2. Send to converter tasks for auto-rules
  a. Ability to auto convert when sent to converter as well, but explain the hazards to the user when they toggle this on.
3. Add mode conversion tool in settings (only shown when user is in dump mode)
4. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
5. Add new onboarding step after 1.5 to suggest user to set up the recommended auto-rules task.
  a. Would need to ask user if they record to a "main" folder and where it is located. Then suggest the auto-rules task to move files from that folder to the app's managed folder.
6. Add ability to grab thumbnail from video file if no thumbnail image is provided
7. Add ability to update thumbnail on youtube/twitch posts
8. Always show window controls regardless of app state. User needs to be able to close the app, via the app, at all times.
  a. Mostly taken care of, buttons still disappear on app error.
9. Add "How to use" page to settings with tips and best practices for using the app.

## Improvement ideas

1. Show warning when user manually user archives a stream item that has not been through the app's archive process, helps remind the user about compression.
2. Horizontal scrolling in the player (in clipping mode) should pan the player instead of zooming.
3. Add new Panel tabs in player page:
  a. Mini streams viewer to see all the streams and easily switch between them. (locked when in clipping mode)
4. Add buy me a coffee link in the about modal:
    ```
    <script type="text/javascript" src="https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js" data-name="bmc-button" data-slug="pjm" data-color="#FFDD00" data-emoji=""  data-font="Cookie" data-text="Buy me a coffee" data-outline-color="#000000" data-font-color="#000000" data-coffee-color="#ffffff" ></script>
    ```
5. It might be too confusing to have clicking on the pop-up player close it. It may need to be play/pause instead. Need to figure out another way to close the pop-up.
6. Add tagging to stream page's "select multiple" mode, so that user can tag multiple stream items at once.
7. Add ability to launch on windows startup in settings.
8. Add ability for app to detect if livestream is currently live and show it in the app.
9. In New / edit stream dialog, move template dropdowns to be next to their respective inputs. (Maybe an unstyled dropdown next to the label?)
10. Update the column widths in the stream list to be more optimal, and add ability for user to customize column widths.
11. Adjust layout of audio merge overlay so the progress bars and percentage are properly aligned and visually clear. Also since the playback and video are still usable while the merger is happening, move the progress items to the sidebar, it's empty anyway during the merge.
12. Allow selecting of clip regions. Add hover styling to indicate it can be selected. When selected, shows it's timecode label above all others.
13. Linkinfy the video title in the player page so that clicking on it opens the corresponding video in its folder.
14. Add clip region markers to the timeline zoom scrollbar to provide a visual indication of where clip regions are located.
15. Allow the right side panel in the player page to be collapsible so that users can have more space for the video when needed.

## Bugs

1. While dragging the playhead, the thumbnail hover functionality doesn't work well due it it inconsistently detecting the cursor, the thumbnails should respond to the position of the playhead while dragging.
2. The app main window doesn't seem to remember the correct positioning when it reopens.