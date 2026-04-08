# To-Do

* Attachment to Youtube & Twitch posts
  * Would look for the stream item on user's twitch / youtube channel and link to the post if found. Would also download the thumbnail and attach it to the stream item in the app.
  * When twitch streams are automatically deleted on the website, app would indicate as such and recommend to use the app's archive process.
* Send to converter tasks for auto-rules
  * Ability to auto convert went sent as well, but explain the hazards to the user when they toggle this on.
* Add mode conversion tool in settings (only shown when user is in dump mode)
* Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
* Add new onboarding step after 1.5 to suggest user to set up the recommended auto-rules task.
  * Would need to ask user if they record to a "main" folder and where it is located. Then suggest the auto-rules task to move files from that folder to the app's managed folder.
* Add ability to grab thumbnail from video file if no thumbnail image is provided
* Add ability to update thumbnail on youtube/twitch posts
* Always show window controls regardless of app state. User needs to be able to close the app, via the app, at all times.
  * Mostly taken care of, buttons still disappear on app error.
* Add "How to use" page to settings with tips and best practices for using the app.

# Improvements
* Show main thumbnail of a stream item in the edit metadata dialog (helps user remember which stream item they are editing)
* Show warning when user manually user archives a stream item that has not been through the app's archive process, helps remind the user about compression.
* Horizontal scrolling in the player (in clipping mode) should pan the player instead of zooming.
* Add new Panel tabs in player page:
  * Mini streams viewer to see all the streams and easily switch between them. (locked when in clipping mode)
* Add buy me a coffee link in the about modal:
    ```
    <script type="text/javascript" src="https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js" data-name="bmc-button" data-slug="pjm" data-color="#FFDD00" data-emoji=""  data-font="Cookie" data-text="Buy me a coffee" data-outline-color="#000000" data-font-color="#000000" data-coffee-color="#ffffff" ></script>
    ```
* It might be too confusing to have clicking on the pop-up player close it. It may need to be play/pause instead. Need to figure out another way to close the pop-up.
*