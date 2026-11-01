# Disposable SSH target for installer integration tests. Never deploy publicly.
FROM docker:28-cli
RUN apk add --no-cache openssh-server util-linux tar && ssh-keygen -A && mkdir -p /root/.ssh && chmod 700 /root/.ssh && ln -s /usr/local/bin/docker /usr/bin/docker
COPY authorized.pub /root/.ssh/authorized_keys
RUN chmod 600 /root/.ssh/authorized_keys && echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config && echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config && passwd -d root
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
