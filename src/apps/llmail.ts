// checking mail should probably be done in a 'cycle' where the llm reads, cleans and decides what actions to take

/*
Command:
    users: Get list of users on the system

    llmail: Thead based local email system
        read <id>: Read a thread
        reply <id> "<message>": Reply to a thread
        new "<users>" "subject" "message": Create a new thread
        adduser <id> <username>: Add a user to a thread
    

    Comamnds: inbox, read <id>, reply <id> "<message>", send "<users>" "subject" "message", adduser <id> <username>
    id | date | thread subject | from | to

    llmail read <id>
    Thread Subject: hello world
    Members: Bob, Jill, Steve, John

    From: Bob
    Date: 2021-08-01 12:00
    Message: 
    Hello Jill, I hope you are doing well. I was thinking about our conversation the other day and 
    I think we should move forward with the plan. Let me know if you have any questions.

    From: Jill
    Date: 2021-08-02 12:00
    Message: 
    Hey Bob, I agree let's do that
*/
