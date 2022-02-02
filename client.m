t = tcpclient("127.0.0.1", 1337);
configureTerminator(t, "LF", "CR/LF");
while true
    while t.NumBytesAvailable > 0
        msg = readline(t);
        json = jsondecode(msg);
        if json.action == 'process'
            disp(json);
            t.writeline(jsonencode(json));
        end
    end
end